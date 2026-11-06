import type { Point } from '../types.js';
import type { MatchTarget, TextBlock } from '../vision-types.js';
export interface VisionPort {
    ocr(screenshotPath: string): Promise<TextBlock[]>;
    findTemplate(screenshotPath: string, templatePath: string, threshold?: number): Promise<Point | null>;
    matchTemplates(screenshotPath: string, templates: Array<{
        label: string;
        path: string;
    }>, threshold?: number): Promise<MatchTarget[]>;
    locateText(screenshotPath: string, text: string): Promise<Point | null>;
}
