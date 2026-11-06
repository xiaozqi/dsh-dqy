import type { StateStorePort } from '../../domain/ports/state-store.port.js';
export declare class FileStateStore implements StateStorePort {
    private readonly dir;
    constructor(dir: string);
    load<T>(key: string, fallback: T): T;
    save<T>(key: string, value: T): void;
    private pathFor;
}
