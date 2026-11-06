export interface SpokenMessage {
    text: string;
    audioPath: string;
    durationMs: number;
}
export interface VoiceSpec {
    name: string;
    engine: 'edge-tts';
    language: string;
}
export interface ClonedVoice {
    name: string;
    samplePath: string;
    promptText: string;
}
