export type LogFn = (msg: string) => void;
export declare function createFileLogger(path: string, maxBytes?: number): LogFn;
