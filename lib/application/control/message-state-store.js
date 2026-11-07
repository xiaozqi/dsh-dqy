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
        // The journal is an idempotency aid, not an archive: without pruning it
        // grows one entry per notification forever, and every save rewrites the
        // whole file.
        const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
        for (const [key, record] of this.records) {
            if (record.updatedAt < cutoff) {
                this.records.delete(key);
            }
        }
        if (this.records.size > 2000) {
            const oldest = [...this.records.entries()]
                .sort((left, right) => left[1].updatedAt - right[1].updatedAt)
                .slice(0, this.records.size - 2000);
            for (const [key] of oldest) {
                this.records.delete(key);
            }
        }
        const payload = Object.fromEntries(this.records);
        this.store.save(STORE_KEY, payload);
    }
}
