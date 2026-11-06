import { PHASE_TRANSITIONS, } from '../../domain/control-types.js';
import { GuardrailError } from '../../domain/errors.js';
const STORE_KEY = 'message-state';
export class MessageStateStore {
    store;
    records;
    constructor(store) {
        this.store = store;
        const persisted = store.load(STORE_KEY, {});
        this.records = new Map(Object.entries(persisted));
    }
    seen(key) {
        return this.records.has(key);
    }
    claim(input) {
        const existing = this.records.get(input.idempotencyKey);
        if (existing) {
            return existing;
        }
        const record = {
            ...input,
            phase: 'pending',
            updatedAt: Date.now(),
            attempts: 0,
        };
        this.records.set(record.idempotencyKey, record);
        this.persist();
        return record;
    }
    get(key) {
        const record = this.records.get(key);
        return record ? { ...record } : undefined;
    }
    transition(key, phase, lastError) {
        const record = this.records.get(key);
        if (!record) {
            throw new GuardrailError('UNKNOWN_MESSAGE', `cannot transition unknown message: ${key}`);
        }
        if (!PHASE_TRANSITIONS[record.phase].includes(phase)) {
            throw new GuardrailError('ILLEGAL_TRANSITION', `${record.phase} -> ${phase} is not allowed`);
        }
        const updated = {
            ...record,
            phase,
            updatedAt: Date.now(),
            attempts: phase === 'acting' ? record.attempts + 1 : record.attempts,
            lastError: lastError ?? record.lastError,
        };
        this.records.set(key, updated);
        this.persist();
        return { ...updated };
    }
    list() {
        return [...this.records.values()].map(record => ({ ...record }));
    }
    persist() {
        const payload = Object.fromEntries(this.records);
        this.store.save(STORE_KEY, payload);
    }
}
