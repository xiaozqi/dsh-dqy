import { ProcessSupervisor } from '../process-supervisor.js';
// TTS / ASR workers are long-running python processes; a wedged one must fail
// the call instead of blocking the conversation. One shared supervisor gives
// each call a deadline and kills the child tree on expiry.
const voiceSupervisor = new ProcessSupervisor();
import { VisionError } from '../../domain/errors.js';
export class PythonVoice {
    options;
    constructor(options) {
        this.options = options;
    }
    async speak(text, voice = this.options.defaultVoice, play = true) {
        const out = this.audioBasePath(text);
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
        }));
        return {
            text,
            audioPath: data.audioPath,
            durationMs: data.durationMs ?? estimateDurationMs(text),
        };
    }
    async createVoice(samplePath, name = 'mine') {
        const data = (await this.call({
            mode: 'clone',
            sample: samplePath,
            name,
            voicesDir: this.options.voicesDir,
        }));
        return data;
    }
    async listen(audioPath) {
        const data = (await this.call({
            mode: 'listen',
            audio: audioPath,
        }));
        return data;
    }
    async playLocal(audioPath) {
        await this.call({
            mode: 'play',
            audio: audioPath,
        });
    }
    async listenPhone(durationMs, adbPath, deviceSerial) {
        const ts = new Date().toISOString().replace(/[:.]/g, '-');
        const remote = `/sdcard/dqy/rec-${ts}.mp4`;
        const local = `${this.options.audioDir}/rec-${ts}.mp4`;
        const data = (await this.call({
            mode: 'listen_phone',
            durationMs,
            adbPath,
            deviceSerial,
            remote,
            local,
        }));
        return data;
    }
    audioBasePath(text) {
        const ts = new Date().toISOString().replace(/[:.]/g, '-');
        const hash = [...text].length;
        return `${this.options.audioDir}/fish-${ts}-${hash}`;
    }
    async call(command) {
        const result = await voiceSupervisor.run(this.options.pythonPath, [this.options.workerPath, JSON.stringify(command)], { timeoutMs: 120000 });
        if (result.timedOut) {
            throw new VisionError('VOICE_TIMEOUT', 'voice worker exceeded 120s and was killed');
        }
        if (result.code !== 0) {
            throw new VisionError('VOICE_PROCESS_FAILED', result.stderr || `worker exit ${result.code}`);
        }
        let parsed;
        try {
            parsed = JSON.parse(result.stdout);
        }
        catch (err) {
            throw new VisionError('VOICE_BAD_JSON', err.message);
        }
        if (!parsed.ok) {
            throw new VisionError('VOICE_WORKER_ERROR', parsed.error ?? 'unknown worker error');
        }
        return parsed.data;
    }
}
function estimateDurationMs(text) {
    const chars = [...text].length;
    return Math.max(500, chars * 250);
}
