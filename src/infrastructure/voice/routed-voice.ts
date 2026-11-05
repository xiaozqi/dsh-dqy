import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { VoicePort } from '../../domain/ports/voice.port.js'
import type {
  ClonedVoice,
  SpokenMessage,
} from '../../domain/voice-types.js'
import { PythonVoice } from './python-voice.js'
import { VolcTts } from './volc-tts.js'

/**
 * Routes speak requests across synthesis engines while keeping the VoicePort
 * contract single and stable:
 *  - a locally cloned voice (voice.json under voicesDir) -> local engines
 *  - Volcengine configured and the requested voice is not a local clone
 *    -> Volcengine Doubao TTS (emotionally expressive, cloud)
 *  - anything else -> the local PythonVoice (clone engines + edge-tts fallback)
 */
export interface RoutedVoiceOptions {
  pythonVoice: PythonVoice
  volcTts: VolcTts | null
  voicesDir: string
}

export class RoutedVoice implements VoicePort {
  constructor(private readonly options: RoutedVoiceOptions) {}

  async speak(
    text: string,
    voice = 'zh-CN-XiaoxiaoNeural',
    play = true,
  ): Promise<SpokenMessage> {
    const local = this.isCloned(voice)
    if (!local && this.options.volcTts) {
      const message = await this.options.volcTts.speak(text, voice)
      if (play) {
        await this.options.pythonVoice.playLocal(message.audioPath)
      }
      return message
    }
    return this.options.pythonVoice.speak(text, voice, play)
  }

  createVoice(samplePath: string, name = 'mine'): Promise<ClonedVoice> {
    return this.options.pythonVoice.createVoice(samplePath, name)
  }

  listen(audioPath: string): Promise<string> {
    return this.options.pythonVoice.listen(audioPath)
  }

  listenPhone(
    durationMs: number,
    adbPath: string,
    deviceSerial: string,
  ): Promise<string> {
    return this.options.pythonVoice.listenPhone(
      durationMs,
      adbPath,
      deviceSerial,
    )
  }

  private isCloned(voice: string): boolean {
    return existsSync(
      join(this.options.voicesDir, voice, 'voice.json'),
    )
  }
}
