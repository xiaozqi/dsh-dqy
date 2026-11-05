import type { NotificationDecision, NotificationEvent } from '../notification-types.js'

export interface NotificationSource {
  start(): Promise<void>
  stop(): Promise<void>
  subscribe(listener: (e: NotificationEvent) => void): () => void
  get connected(): boolean
}

export interface NotificationStats {
  received: number
  allowed: number
  blocked: number
  canceled: number
  droppedBy: Record<string, number>
}

export interface NotificationPort {
  start(): Promise<void>
  stop(): Promise<void>
  onEvent(cb: (d: NotificationDecision) => void): () => void
  recent(limit?: number): NotificationDecision[]
  stats(): NotificationStats
}

export interface NotificationCancelSink {
  pushCancel(key: string): void
}
