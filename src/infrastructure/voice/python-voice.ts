import { spawn } from 'node:child_process'
import { VisionError } from '../../domain/errors.js'
import type { VoicePort } from '../../domain/ports/voice.port.js'
import type {
  ClonedVoice,
  SpokenMessage,
} from '../../domain/voice-types.js'

interface WorkerResponse {
  ok: boolean
  data?: unknown
  error?: string
}

export interface PythonVoiceOptions {
  pythonPath: string
  workerPath: string
  audioDir: string
  defaultVoice: string
  voicesDir: string
  gptsovitsPythonPath: string
  gptsovitsSynthWorker: string
  gptsovitsSrc: string
  gptsovitsModelsDir: string
}

export class PythonVoice implements VoicePort {
  constructor(
    private readonly options: PythonVoiceOptions,
  ) {}

  async speak(
    text: string,
    voice = this.options.defaultVoice,
    play = true,
  ): Promise<SpokenMessage> {
    const out = this.audioBasePath(text)
    const data = (await this.call({
      mode: 'speak',
      text,
      voice,
      out,
      play,
      voicesDir: this.options.voicesDir,
      gptsovitsPythonPath: this.options.gptsovitsPythonPath,
      gptsovitsSynthWorker: this.options.gptsovitsSynthWorker,
      gptsovitsSrc: this.options.gptsovitsSrc,
      gptsovitsModelsDir: this.options.gptsovitsModelsDir,
    })) as { audioPath: string; durationMs: number | null }
    return {
      text,
      audioPath: data.audioPath,
      durationMs: data.durationMs ?? estimateDurationMs(text),
    }
  }

  async createVoice(
    samplePath: string,
    name = 'mine',
  ): Promise<ClonedVoice> {
    const data = (await this.call({
      mode: 'clone',
      sample: samplePath,
      name,
      voicesDir: this.options.voicesDir,
    })) as ClonedVoice
    return data
  }

  async listen(audioPath: string): Promise<string> {
    const data = (await this.call({
      mode: 'listen',
      audio: audioPath,
    })) as string
    return data
  }

  async playLocal(audioPath: string): Promise<void> {
    await this.call({
      mode: 'play',
      audio: audioPath,
    })
  }

  async listenPhone(
    durationMs: number,
    adbPath: string,
    deviceSerial: string,
  ): Promise<string> {
    const ts = new Date().toISOString().replace(/[:.]/g, '-')
    const remote = `/sdcard/blue-fat-fish/rec-${ts}.mp4`
    const local = `${this.options.audioDir}/rec-${ts}.mp4`
    const data = (await this.call({
      mode: 'listen_phone',
      durationMs,
      adbPath,
      deviceSerial,
      remote,
      local,
    })) as string
    return data
  }

  private audioBasePath(text: string): string {
    const ts = new Date().toISOString().replace(/[:.]/g, '-')
    const hash = [...text].length
    return `${this.options.audioDir}/fish-${ts}-${hash}`
  }

  private call(command: Record<string, unknown>): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const child = spawn(
        this.options.pythonPath,
        [this.options.workerPath, JSON.stringify(command)],
        { windowsHide: true },
      )
      const outChunks: Buffer[] = []
      const errChunks: Buffer[] = []

      child.stdout.on('data', chunk => outChunks.push(Buffer.from(chunk)))
      child.stderr.on('data', chunk => errChunks.push(Buffer.from(chunk)))
      child.on('error', err => {
        reject(new VisionError('VOICE_NOT_STARTABLE', err.message))
      })
      child.on('close', code => {
        if (code !== 0) {
          reject(
            new VisionError(
              'VOICE_PROCESS_FAILED',
              Buffer.concat(errChunks).toString('utf8') ||
                `worker exit ${code}`,
            ),
          )
          return
        }
        let parsed: WorkerResponse
        try {
          parsed = JSON.parse(
            Buffer.concat(outChunks).toString('utf8'),
          ) as WorkerResponse
        } catch (err) {
          reject(
            new VisionError('VOICE_BAD_JSON', (err as Error).message),
          )
          return
        }
        if (!parsed.ok) {
          reject(
            new VisionError(
              'VOICE_WORKER_ERROR',
              parsed.error ?? 'unknown worker error',
            ),
          )
          return
        }
        resolve(parsed.data)
      })
    })
  }
}

function estimateDurationMs(text: string): number {
  const chars = [...text].length
  return Math.max(500, chars * 250)
}
