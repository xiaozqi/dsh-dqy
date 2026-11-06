// Persistence abstraction for small JSON state (run mode, message state).
// The application layer depends on this port; the file-based implementation
// lives in infrastructure so no business code touches the filesystem.
export interface StateStorePort {
  load<T>(key: string, fallback: T): T
  save<T>(key: string, value: T): void
}
