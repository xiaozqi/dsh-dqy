import {
  PHASE_TRANSITIONS,
  type MessagePhase,
} from '../../domain/control-types.js'
import { GuardrailError } from '../../domain/errors.js'
import type { StateStorePort } from '../../domain/ports/state-store.port.js'
import type {
  MessageStatePort,
  MessageStateRecord,
  NewMessageClaim,
} from '../../domain/ports/message-state.port.js'

const STORE_KEY = 'message-state'

type PersistedState = Record<string, MessageStateRecord>

export class MessageStateStore implements MessageStatePort {
  private readonly records: Map<string, MessageStateRecord>

  constructor(private readonly store: StateStorePort) {
    const persisted = store.load<PersistedState>(STORE_KEY, {})
    this.records = new Map(Object.entries(persisted))
  }

  seen(key: string): boolean {
    return this.records.has(key)
  }

  claim(input: NewMessageClaim): MessageStateRecord {
    const existing = this.records.get(input.idempotencyKey)
    if (existing) {
      return existing
    }
    const record: MessageStateRecord = {
      ...input,
      phase: 'pending',
      updatedAt: Date.now(),
      attempts: 0,
    }
    this.records.set(record.idempotencyKey, record)
    this.persist()
    return record
  }

  get(key: string): MessageStateRecord | undefined {
    const record = this.records.get(key)
    return record ? { ...record } : undefined
  }

  transition(
    key: string,
    phase: MessagePhase,
    lastError?: string,
  ): MessageStateRecord {
    const record = this.records.get(key)
    if (!record) {
      throw new GuardrailError(
        'UNKNOWN_MESSAGE',
        `cannot transition unknown message: ${key}`,
      )
    }
    if (!PHASE_TRANSITIONS[record.phase].includes(phase)) {
      throw new GuardrailError(
        'ILLEGAL_TRANSITION',
        `${record.phase} -> ${phase} is not allowed`,
      )
    }
    const updated: MessageStateRecord = {
      ...record,
      phase,
      updatedAt: Date.now(),
      attempts: phase === 'acting' ? record.attempts + 1 : record.attempts,
      lastError: lastError ?? record.lastError,
    }
    this.records.set(key, updated)
    this.persist()
    return { ...updated }
  }

  list(): MessageStateRecord[] {
    return [...this.records.values()].map(record => ({ ...record }))
  }

  private persist(): void {
    const payload: PersistedState = Object.fromEntries(this.records)
    this.store.save(STORE_KEY, payload)
  }
}
