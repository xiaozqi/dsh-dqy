import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
const EMPTY = { records: [], tasks: {} };
export class JsonMemory {
    file;
    cache = null;
    constructor(file) {
        this.file = file;
        mkdir(dirname(file), { recursive: true });
    }
    async remember(record) {
        const db = await this.load();
        const full = {
            ...record,
            id: randomUUID(),
            createdAt: new Date().toISOString(),
        };
        db.records.push(full);
        await this.persist();
        return full;
    }
    async recall(query, limit = 5, kind) {
        const db = await this.load();
        const terms = tokenize(query);
        return db.records
            .filter(record => kind === undefined || record.kind === kind)
            .map(record => ({ record, score: scoreRecord(record, terms) }))
            .filter(item => item.score > 0)
            .sort((a, b) => b.score - a.score ||
            b.record.createdAt.localeCompare(a.record.createdAt))
            .slice(0, limit)
            .map(item => item.record);
    }
    async recent(limit) {
        const db = await this.load();
        return [...db.records]
            .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
            .slice(0, limit);
    }
    async saveTaskResult(record) {
        const db = await this.load();
        db.tasks[record.app] = record;
        await this.persist();
    }
    async getTaskResult(app) {
        const db = await this.load();
        return db.tasks[app] ?? null;
    }
    async listTaskResults() {
        const db = await this.load();
        return Object.values(db.tasks);
    }
    async load() {
        if (this.cache)
            return this.cache;
        let db;
        try {
            const raw = await readFile(this.file, 'utf8');
            db = JSON.parse(raw);
        }
        catch {
            db = structuredClone(EMPTY);
        }
        this.cache = db;
        return db;
    }
    async persist() {
        const tmp = `${this.file}.tmp`;
        await writeFile(tmp, JSON.stringify(this.cache), 'utf8');
        await rename(tmp, this.file);
    }
}
function tokenize(query) {
    return query.toLowerCase().match(/[a-z0-9]+|[\u4e00-\u9fa5]/g) ?? [];
}
function scoreRecord(record, terms) {
    const haystack = record.content.toLowerCase();
    let score = 0;
    for (const term of terms) {
        if (haystack.includes(term))
            score += 1;
        if (record.tags.some(tag => tag.toLowerCase() === term))
            score += 2;
    }
    return score;
}
