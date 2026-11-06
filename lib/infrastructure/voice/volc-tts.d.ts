import type { SpokenMessage } from '../../domain/voice-types.js';
export interface VolcTtsOptions {
    /** New-console single-key auth (recommended). */
    apiKey?: string;
    /** Legacy-console auth, used only when apiKey is absent. */
    appId?: string;
    accessKey?: string;
    /** Service resource id; seed-tts-2.0 = Doubao TTS 2.0 (character billing). */
    resourceId?: string;
    /** Doubao TTS 2.0 voice id, pick from the console voice list. */
    speaker: string;
    audioDir: string;
}
export declare class VolcTts {
    private readonly options;
    constructor(options: VolcTtsOptions);
    speak(text: string, voice?: string, _play?: boolean): Promise<SpokenMessage>;
    private submit;
    private pollUntilDone;
    private download;
    private post;
}
