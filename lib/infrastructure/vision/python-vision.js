import { spawn } from 'node:child_process';
import { VisionError } from '../../domain/errors.js';
export class PythonVision {
    pythonPath;
    workerPath;
    defaultThreshold;
    constructor(pythonPath, workerPath, defaultThreshold) {
        this.pythonPath = pythonPath;
        this.workerPath = workerPath;
        this.defaultThreshold = defaultThreshold;
    }
    async ocr(screenshotPath) {
        const data = (await this.call({
            mode: 'ocr',
            image: screenshotPath,
        }));
        return data.map(toTextBlock);
    }
    async findTemplate(screenshotPath, templatePath, threshold = this.defaultThreshold) {
        const point = (await this.call({
            mode: 'find_template',
            image: screenshotPath,
            template: templatePath,
            threshold,
        }));
        return point ? { x: point[0], y: point[1] } : null;
    }
    async matchTemplates(screenshotPath, templates, threshold = this.defaultThreshold) {
        const raw = (await this.call({
            mode: 'match_templates',
            image: screenshotPath,
            templates,
            threshold,
        }));
        return raw.map(t => ({
            label: t.label,
            template: t.template,
            score: t.score,
            point: { x: t.point[0], y: t.point[1] },
        }));
    }
    async locateText(screenshotPath, text) {
        const point = (await this.call({
            mode: 'locate_text',
            image: screenshotPath,
            text,
        }));
        return point ? { x: point[0], y: point[1] } : null;
    }
    call(command) {
        return new Promise((resolve, reject) => {
            const child = spawn(this.pythonPath, [this.workerPath, JSON.stringify(command)], { windowsHide: true });
            const outChunks = [];
            const errChunks = [];
            child.stdout.on('data', chunk => outChunks.push(Buffer.from(chunk)));
            child.stderr.on('data', chunk => errChunks.push(Buffer.from(chunk)));
            child.on('error', err => {
                reject(new VisionError('VISION_NOT_STARTABLE', err.message));
            });
            child.on('close', code => {
                if (code !== 0) {
                    reject(new VisionError('VISION_PROCESS_FAILED', Buffer.concat(errChunks).toString('utf8') ||
                        `worker exit ${code}`));
                    return;
                }
                let parsed;
                try {
                    parsed = JSON.parse(Buffer.concat(outChunks).toString('utf8'));
                }
                catch (err) {
                    reject(new VisionError('VISION_BAD_JSON', err.message));
                    return;
                }
                if (!parsed.ok) {
                    reject(new VisionError('VISION_WORKER_ERROR', parsed.error ?? 'unknown worker error'));
                    return;
                }
                resolve(parsed.data);
            });
        });
    }
}
function toTextBlock(raw) {
    const [left, top, right, bottom] = raw.bounds;
    const [cx, cy] = raw.center;
    return {
        text: raw.text,
        confidence: raw.confidence,
        bounds: { left, top, right, bottom },
        center: { x: cx, y: cy },
    };
}
