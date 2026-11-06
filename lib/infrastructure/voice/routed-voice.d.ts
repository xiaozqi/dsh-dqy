import type { VoicePort } from '../../domain/ports/voice.port.js';
import type { ClonedVoice, SpokenMessage } from '../../domain/voice-types.js';
import { PythonVoice } from './python-voice.js';
import { VolcTts } from './volc-tts.js';
/**
 * Routes speak requests across synthesis engines while keeping the VoicePort
 * contract single and stable:
 *  - a locally cloned voice (voice.json under voicesDir) -> local engines
 *  - Volcengine configured and the requested voice is not a local clone
 *    -> Volcengine Doubao TTS (emotionally expressive, cloud)
 *  - anything else -> the local PythonVoice (clone engines + edge-tts fallback)
 */
export interface RoutedVoiceOptions {
    pythonVoice: PythonVoice;
    volcTts: VolcTts | null;
    voicesDir: string;
}
export declare class RoutedVoice implements VoicePort {
    private readonly options;
    constructor(options: RoutedVoiceOptions);
    speak(text: string, voice?: string, play?: boolean): Promise<SpokenMessage>;
    createVoice(samplePath: string, name?: string): Promise<ClonedVoice>;
    listen(audioPath: string): Promise<string>;
    listenPhone(durationMs: number, adbPath: string, deviceSerial: string): Promise<string>;
    private isCloned;
}
