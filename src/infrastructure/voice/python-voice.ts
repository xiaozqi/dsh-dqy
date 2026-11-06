import { ProcessSupervisor } from '../process-supervisor.js'

// TTS / ASR workers are long-running python processes; a wedged one must fail
// the call instead of blocking the conversation. One shared supervisor gives
// each call a deadline and kills the child tree on expiry.
const voiceSupervisor = new ProcessSupervisor()
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
    const remote = `/sdcard/dqy/rec-${ts}.mp4`
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

  private async call(command: Record<string, unknown>): Promise<unknown> {
    const result = await voiceSupervisor.run(
      this.options.pythonPath,
      [this.options.workerPath, JSON.stringify(command)],
      { timeoutMs: 120000 },
    )
    if (result.timedOut) {
      throw new VisionError(
        'VOICE_TIMEOUT',
        'voice worker exceeded 120s and was killed',
      )
    }
    if (result.code !== 0) {
      throw new VisionError(
        'VOICE_PROCESS_FAILED',
        result.stderr || `worker exit ${result.code}`,
      )
    }
    let parsed: WorkerResponse
    try {
      parsed = JSON.parse(result.stdout) as WorkerResponse
    } catch (err) {
      throw new VisionError('VOICE_BAD_JSON', (err as Error).message)
    }
    if (!parsed.ok) {
      throw new VisionError(
        'VOICE_WORKER_ERROR',
        parsed.error ?? 'unknown worker error',
      )
    }
    return parsed.data
  }
}

function estimateDurationMs(text: string): number {
  const chars = [...text].length
  return Math.max(500, chars * 250)
}
