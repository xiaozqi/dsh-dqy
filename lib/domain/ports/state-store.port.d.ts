export interface StateStorePort {
    load<T>(key: string, fallback: T): T;
    save<T>(key: string, value: T): void;
}
