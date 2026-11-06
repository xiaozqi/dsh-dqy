import { createServer } from 'node:http'
import type {
  IncomingMessage,
  Server,
  ServerResponse,
} from 'node:http'
import type { NotificationEvent } from '../../domain/notification-types.js'
import type {
  NotificationCancelSink,
  NotificationSource,
} from '../../domain/ports/notification.port.js'
import { createFileLogger, type LogFn } from '../file-logger.js'

interface NotifyBody {
  app?: unknown
  title?: unknown
  text?: unknown
  when?: unknown
  id?: unknown
  importance?: unknown
}

export interface HttpNotificationOptions {
  /**
   * Interface to bind. Loopback by default: `adb reverse` already forwards the
   * phone to the host loopback, so a wider bind only lets the LAN forge
   * notifications into an agent that can send messages.
   */
  bindHost?: string
  /** When set, the bridge must send `x-fish-token` with the same value. */
  token?: string
  maxBodyBytes?: number
  /** App names allowed to inject events; empty means "any". */
  allowedApps?: readonly string[]
  logger?: LogFn
}

const MAX_TEXT = 4000
const DEFAULT_MAX_BODY = 64 * 1024

export class HttpNotificationSource
  implements NotificationSource, NotificationCancelSink
{
  lastError: string | null = null
  private server: Server | null = null
  private readonly listeners = new Set<(e: NotificationEvent) => void>()
  private readonly pendingCancels: string[] = []
  private readonly logger: LogFn
  private readonly bindHost: string
  private readonly token: string
  private readonly maxBodyBytes: number
  private readonly allowedApps: Set<string>
  private seq = 0

  constructor(
    private readonly port = 14123,
    logPath: string,
    options: HttpNotificationOptions = {},
  ) {
    this.bindHost = options.bindHost ?? '127.0.0.1'
    this.token = options.token ?? ''
    this.maxBodyBytes = options.maxBodyBytes ?? DEFAULT_MAX_BODY
    this.allowedApps = new Set(options.allowedApps ?? [])
    this.logger = options.logger ?? createFileLogger(logPath)
  }

  get connected(): boolean {
    return this.server?.listening ?? false
  }

  async start(): Promise<void> {
    if (this.server?.listening) {
      return
    }
    try {
      await new Promise<void>(resolve => {
        const server = createServer((req, res) => this.handle(req, res))
        server.once('error', err => {
          this.lastError = (err as Error).message
          resolve()
        })
        server.listen(this.port, this.bindHost, () => {
          server.removeAllListeners('error')
          this.server = server
          this.lastError = null
          resolve()
        })
      })
    } catch (err) {
      this.lastError = (err as Error).message
    }
  }

  async stop(): Promise<void> {
    const server = this.server
    this.server = null
    if (!server) {
      return
    }
    await new Promise<void>(resolve => server.close(() => resolve()))
  }

  subscribe(listener: (e: NotificationEvent) => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  pushCancel(key: string): void {
    if (this.pendingCancels.includes(key)) {
      return
    }
    this.pendingCancels.push(key)
    if (this.pendingCancels.length > 500) {
      this.pendingCancels.shift()
    }
  }

  private handle(req: IncomingMessage, res: ServerResponse): void {
    if (
      req.method === 'GET' &&
      typeof req.url === 'string' &&
      req.url.startsWith('/api/pending-cancels')
    ) {
      const cancels = this.pendingCancels.splice(0, this.pendingCancels.length)
      res
        .writeHead(200, { 'content-type': 'application/json' })
        .end(JSON.stringify({ cancels }))
      return
    }
    if (req.method !== 'POST') {
      res.writeHead(404).end()
      return
    }
    if (this.token && String(req.headers['x-fish-token'] ?? '') !== this.token) {
      res.writeHead(403).end()
      return
    }
    const chunks: Buffer[] = []
    let size = 0
    let tooLarge = false
    req.on('data', chunk => {
      if (tooLarge) {
        return
      }
      const buffer = Buffer.from(chunk as Buffer)
      size += buffer.length
      if (size > this.maxBodyBytes) {
        tooLarge = true
        chunks.length = 0
        res.writeHead(413, { 'content-type': 'application/json' }).end(
          '{"ok":false,"error":"body too large"}',
        )
        return
      }
      chunks.push(buffer)
    })
    req.on('end', () => {
      if (tooLarge) {
        return
      }
      try {
        const body = JSON.parse(
          Buffer.concat(chunks).toString('utf8'),
        ) as NotifyBody
        const event = this.toEvent(body)
        if (!event) {
          res.writeHead(400, { 'content-type': 'application/json' }).end(
            '{"ok":false,"error":"app not allowed"}',
          )
          return
        }
        this.appendLog(event)
        for (const cb of this.listeners) {
          try {
            cb(event)
          } catch {
            /* a listener failure must not break the HTTP endpoint */
          }
        }
        res
          .writeHead(200, { 'content-type': 'application/json' })
          .end('{"ok":true}')
      } catch {
        res.writeHead(400).end()
      }
    })
    req.on('error', () => {
      res.writeHead(400).end()
    })
  }

  private toEvent(body: NotifyBody): NotificationEvent | null {
    const app = typeof body.app === 'string' ? body.app.slice(0, 200) : ''
    if (this.allowedApps.size > 0 && !this.allowedApps.has(app)) {
      return null
    }
    const id =
      typeof body.id === 'string' && body.id
        ? body.id.slice(0, 200)
        : `${Date.now()}-${this.seq++}`
    const when = typeof body.when === 'number' ? body.when : Date.now()
    const importance =
      typeof body.importance === 'number' &&
      Number.isFinite(body.importance)
        ? body.importance
        : 2
    return {
      id,
      app,
      title: typeof body.title === 'string' ? body.title.slice(0, MAX_TEXT) : '',
      text: typeof body.text === 'string' ? body.text.slice(0, MAX_TEXT) : '',
      when,
      importance,
      source: 'http',
    }
  }

  private appendLog(event: NotificationEvent): void {
    try {
      this.logger(JSON.stringify(event))
    } catch {
      /* logging failure must not break delivery */
    }
  }
}
