import { ProcessSupervisor } from '../process-supervisor.js';
// OCR runs on every fish_ocr call and template lookup; a wedged python worker
// used to hang the whole tool call. One shared supervisor gives each call a
// deadline and kills the child tree on expiry.
const visionSupervisor = new ProcessSupervisor();
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
    async call(command) {
        const result = await visionSupervisor.run(this.pythonPath, [this.workerPath, JSON.stringify(command)], { timeoutMs: 30000 });
        if (result.timedOut) {
            throw new VisionError('VISION_TIMEOUT', 'vision worker exceeded 30s and was killed');
        }
        if (result.code !== 0) {
            throw new VisionError('VISION_PROCESS_FAILED', result.stderr || `worker exit ${result.code}`);
        }
        let parsed;
        try {
            parsed = JSON.parse(result.stdout);
        }
        catch (err) {
            throw new VisionError('VISION_BAD_JSON', err.message);
        }
        if (!parsed.ok) {
            throw new VisionError('VISION_WORKER_ERROR', parsed.error ?? 'unknown worker error');
        }
        return parsed.data;
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
