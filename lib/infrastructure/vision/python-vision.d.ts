import type { VisionPort } from '../../domain/ports/vision.port.js';
import type { Point } from '../../domain/types.js';
import type { MatchTarget, TextBlock } from '../../domain/vision-types.js';
export declare class PythonVision implements VisionPort {
    private readonly pythonPath;
    private readonly workerPath;
    private readonly defaultThreshold;
    constructor(pythonPath: string, workerPath: string, defaultThreshold: number);
    ocr(screenshotPath: string): Promise<TextBlock[]>;
    findTemplate(screenshotPath: string, templatePath: string, threshold?: number): Promise<Point | null>;
    matchTemplates(screenshotPath: string, templates: Array<{
        label: string;
        path: string;
    }>, threshold?: number): Promise<MatchTarget[]>;
    locateText(screenshotPath: string, text: string): Promise<Point | null>;
    private call;
}
