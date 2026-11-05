import { appendFileSync, mkdirSync } from 'node:fs'
import { createServer } from 'node:http'
import type {
  IncomingMessage,
  Server,
  ServerResponse,
} from 'node:http'
import { dirname } from 'node:path'
import type { NotificationEvent } from '../../domain/notification-types.js'
import type {
  NotificationCancelSink,
  NotificationSource,
} from '../../domain/ports/notification.port.js'

interface NotifyBody {
  app?: unknown
  title?: unknown
  text?: unknown
  when?: unknown
  id?: unknown
}

export class HttpNotificationSource
  implements NotificationSource, NotificationCancelSink
{
  lastError: string | null = null
  private server: Server | null = null
  private readonly listeners = new Set<(e: NotificationEvent) => void>()
  private readonly pendingCancels: string[] = []
  private seq = 0

  constructor(
    private readonly port = 14123,
    private readonly logPath: string,
  ) {}

  get connected(): boolean {
    return this.server?.listening ?? false
  }

  async start(): Promise<void> {
    if (this.server?.listening) {
      return
    }
    try {
      mkdirSync(dirname(this.logPath), { recursive: true })
      await new Promise<void>(resolve => {
        const server = createServer((req, res) => this.handle(req, res))
        server.once('error', err => {
          this.lastError = (err as Error).message
          resolve()
        })
        server.listen(this.port, '0.0.0.0', () => {
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
    const chunks: Buffer[] = []
    req.on('data', chunk => chunks.push(Buffer.from(chunk as Buffer)))
    req.on('end', () => {
      try {
        const body = JSON.parse(
          Buffer.concat(chunks).toString('utf8'),
        ) as NotifyBody
        const event = this.toEvent(body)
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

  private toEvent(body: NotifyBody): NotificationEvent {
    const id =
      typeof body.id === 'string' && body.id
        ? body.id
        : `${Date.now()}-${this.seq++}`
    const when = typeof body.when === 'number' ? body.when : Date.now()
    return {
      id,
      app: typeof body.app === 'string' ? body.app : '',
      title: typeof body.title === 'string' ? body.title : '',
      text: typeof body.text === 'string' ? body.text : '',
      when,
      importance: 2,
      source: 'http',
    }
  }

  private appendLog(event: NotificationEvent): void {
    try {
      appendFileSync(this.logPath, JSON.stringify(event) + '\n', 'utf8')
    } catch {
      /* logging failure must not break delivery */
    }
  }
}
