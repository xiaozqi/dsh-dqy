import { spawn } from 'node:child_process';
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
        const remote = `/sdcard/blue-fat-fish/rec-${ts}.mp4`;
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
    call(command) {
        return new Promise((resolve, reject) => {
            const child = spawn(this.options.pythonPath, [this.options.workerPath, JSON.stringify(command)], { windowsHide: true });
            const outChunks = [];
            const errChunks = [];
            child.stdout.on('data', chunk => outChunks.push(Buffer.from(chunk)));
            child.stderr.on('data', chunk => errChunks.push(Buffer.from(chunk)));
            child.on('error', err => {
                reject(new VisionError('VOICE_NOT_STARTABLE', err.message));
            });
            child.on('close', code => {
                if (code !== 0) {
                    reject(new VisionError('VOICE_PROCESS_FAILED', Buffer.concat(errChunks).toString('utf8') ||
                        `worker exit ${code}`));
                    return;
                }
                let parsed;
                try {
                    parsed = JSON.parse(Buffer.concat(outChunks).toString('utf8'));
                }
                catch (err) {
                    reject(new VisionError('VOICE_BAD_JSON', err.message));
                    return;
                }
                if (!parsed.ok) {
                    reject(new VisionError('VOICE_WORKER_ERROR', parsed.error ?? 'unknown worker error'));
                    return;
                }
                resolve(parsed.data);
            });
        });
    }
}
function estimateDurationMs(text) {
    const chars = [...text].length;
    return Math.max(500, chars * 250);
}
