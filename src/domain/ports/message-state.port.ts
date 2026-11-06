import type { MessagePhase } from '../control-types.js'

export interface MessageStateRecord {
  idempotencyKey: string
  app: string
  conversationId: string
  textHash: string
  phase: MessagePhase
  updatedAt: number
  attempts: number
  lastError?: string
}

export interface NewMessageClaim {
  idempotencyKey: string
  app: string
  conversationId: string
  textHash: string
}

export interface MessageStatePort {
  seen(key: string): boolean
  claim(record: NewMessageClaim): MessageStateRecord
  get(key: string): MessageStateRecord | undefined
  transition(key: string, phase: MessagePhase, lastError?: string): MessageStateRecord
  list(): MessageStateRecord[]
}
