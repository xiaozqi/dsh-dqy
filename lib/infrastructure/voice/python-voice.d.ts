import type { VoicePort } from '../../domain/ports/voice.port.js';
import type { ClonedVoice, SpokenMessage } from '../../domain/voice-types.js';
export interface PythonVoiceOptions {
    pythonPath: string;
    workerPath: string;
    audioDir: string;
    defaultVoice: string;
    voicesDir: string;
    gptsovitsPythonPath: string;
    gptsovitsSynthWorker: string;
    gptsovitsSrc: string;
    gptsovitsModelsDir: string;
}
export declare class PythonVoice implements VoicePort {
    private readonly options;
    constructor(options: PythonVoiceOptions);
    speak(text: string, voice?: string, play?: boolean): Promise<SpokenMessage>;
    createVoice(samplePath: string, name?: string): Promise<ClonedVoice>;
    listen(audioPath: string): Promise<string>;
    playLocal(audioPath: string): Promise<void>;
    listenPhone(durationMs: number, adbPath: string, deviceSerial: string): Promise<string>;
    private audioBasePath;
    private call;
}
