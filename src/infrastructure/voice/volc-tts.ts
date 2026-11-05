import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { randomUUID } from 'node:crypto'
import { VoiceError } from '../../domain/errors.js'
import type { SpokenMessage } from '../../domain/voice-types.js'

const BASE = 'https://openspeech.bytedance.com/api/v3/tts'

export interface VolcTtsOptions {
  /** New-console single-key auth (recommended). */
  apiKey?: string
  /** Legacy-console auth, used only when apiKey is absent. */
  appId?: string
  accessKey?: string
  /** Service resource id; seed-tts-2.0 = Doubao TTS 2.0 (character billing). */
  resourceId?: string
  /** Doubao TTS 2.0 voice id, pick from the console voice list. */
  speaker: string
  audioDir: string
}

interface VolcResponse {
  code: number
  message?: string
  data?: {
    task_id?: string
    task_status?: number
    audio_url?: string
    [key: string]: unknown
  }
}

export class VolcTts {
  constructor(private readonly options: VolcTtsOptions) {}

  async speak(
    text: string,
    voice = this.options.speaker,
    _play = false,
  ): Promise<SpokenMessage> {
    const taskId = await this.submit(text, voice)
    const audioUrl = await this.pollUntilDone(taskId)
    const audioPath = await this.download(audioUrl, text)
    return {
      text,
      audioPath,
      durationMs: estimateDurationMs(text),
    }
  }

  private async submit(text: string, speaker: string): Promise<string> {
    const body = {
      user: { uid: 'dsh-blue-fat-fish' },
      unique_id: randomUUID(),
      req_params: {
        text,
        speaker,
        audio_params: {
          format: 'mp3',
          sample_rate: 24000,
        },
      },
    }
    const res = await this.post('/submit', body)
    if (res.code !== 20000000 || !res.data?.task_id) {
      throw new VoiceError(
        'VOLC_SUBMIT_FAILED',
        `code=${res.code} message=${res.message ?? ''}`,
      )
    }
    return res.data.task_id
  }

  private async pollUntilDone(taskId: string): Promise<string> {
    const deadline = Date.now() + 120_000
    while (Date.now() < deadline) {
      const res = await this.post('/query', { task_id: taskId })
      if (res.code !== 20000000 || !res.data) {
        throw new VoiceError(
          'VOLC_QUERY_FAILED',
          `code=${res.code} message=${res.message ?? ''}`,
        )
      }
      const status = res.data.task_status ?? 0
      if (status === 2) {
        if (!res.data.audio_url) {
          throw new VoiceError('VOLC_NO_AUDIO', 'audio_url missing')
        }
        return res.data.audio_url
      }
      if (status === 3) {
        throw new VoiceError('VOLC_TASK_FAILED', 'synthesis failed')
      }
      await new Promise(r => setTimeout(r, 2000))
    }
    throw new VoiceError('VOLC_TIMEOUT', 'query polling timed out')
  }

  private async download(audioUrl: string, text: string): Promise<string> {
    const resp = await fetch(audioUrl)
    if (!resp.ok) {
      throw new VoiceError('VOLC_DOWNLOAD_FAILED', `http ${resp.status}`)
    }
    const buffer = Buffer.from(await resp.arrayBuffer())
    const ts = new Date().toISOString().replace(/[:.]/g, '-')
    const hash = [...text].length
    const audioPath = `${this.options.audioDir}/volc-${ts}-${hash}.mp3`
    mkdirSync(dirname(audioPath), { recursive: true })
    writeFileSync(audioPath, buffer)
    return audioPath
  }

  private async post(path: string, body: unknown): Promise<VolcResponse> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Api-Resource-Id': this.options.resourceId ?? 'seed-tts-2.0',
      'X-Api-Request-Id': randomUUID(),
    }
    if (this.options.apiKey) {
      headers['X-Api-Key'] = this.options.apiKey
    } else if (this.options.appId && this.options.accessKey) {
      headers['X-Api-App-Id'] = this.options.appId
      headers['X-Api-Access-Key'] = this.options.accessKey
    } else {
      throw new VoiceError(
        'VOLC_NO_CREDENTIAL',
        'configure volcApiKey (or volcAppId + volcAccessKey)',
      )
    }
    const resp = await fetch(`${BASE}${path}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    })
    if (!resp.ok) {
      throw new VoiceError('VOLC_HTTP', `http ${resp.status}`)
    }
    return (await resp.json()) as VolcResponse
  }
}

function estimateDurationMs(text: string): number {
  const chars = [...text].length
  return Math.max(500, chars * 250)
}
