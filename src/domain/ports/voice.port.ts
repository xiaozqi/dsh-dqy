import type { ClonedVoice, SpokenMessage } from '../voice-types.js'

export interface VoicePort {
  speak(
    text: string,
    voice?: string,
    play?: boolean,
  ): Promise<SpokenMessage>
  createVoice(
    samplePath: string,
    name?: string,
  ): Promise<ClonedVoice>
  listen(audioPath: string): Promise<string>
  listenPhone(
    durationMs: number,
    adbPath: string,
    deviceSerial: string,
  ): Promise<string>
}
