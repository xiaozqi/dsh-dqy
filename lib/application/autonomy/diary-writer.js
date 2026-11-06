const DEFAULT_MAX_EVENTS = 12;
const DEFAULT_MIN_EVENTS = 2;
const DIARY_SYSTEM = [
    'You are the same autonomous phone assistant, now writing YOUR OWN daily diary.',
    'Reflect in first person, short and concrete (2-4 sentences): what you actually did today, what went smoothly or awkwardly, and what you want to try next.',
    'Then extract 1-2 reusable strategies you learned (imperative, one short sentence each). Keep them generic enough to apply on other days.',
    'Reply with STRICT JSON only, no prose, no markdown fences.',
    'Schema: {"diary":"...","strategies":["...","..."]}',
].join('\n');
/**
 * Writes one first-person diary per calendar day plus the strategies distilled
 * from that day's records. Idempotent: a day that already has a diary record
 * (tagged with its day key) is skipped, so this is safe to call every tick.
 * LLM or parse failures degrade to a raw-text diary and never throw, so a
 * broken model can not stall the autonomy loop.
 */
export class DiaryWriter {
    deps;
    maxEvents;
    minEvents;
    constructor(deps, config = {}) {
        this.deps = deps;
        this.maxEvents = config.maxEvents ?? DEFAULT_MAX_EVENTS;
        this.minEvents = config.minEvents ?? DEFAULT_MIN_EVENTS;
    }
    async writeIfDue(now = new Date()) {
        const dayKey = localDayKey(now);
        const all = await this.deps.memory.recent(80);
        if (all.some(r => r.kind === 'diary' && r.tags.includes(dayKey))) {
            return false;
        }
        const today = all.filter(r => (r.kind === 'event' || r.kind === 'lesson' || r.kind === 'goal') &&
            localDayKey(new Date(r.createdAt)) === dayKey);
        if (today.length < this.minEvents)
            return false;
        const lines = today
            .slice(-this.maxEvents)
            .map(r => `- ${r.kind}: ${truncate(r.content, 160)}`);
        const messages = [
            { role: 'system', content: DIARY_SYSTEM },
            {
                role: 'user',
                content: `today: ${dayKey}\nrecent activity:\n${lines.join('\n')}`,
            },
        ];
        let raw;
        try {
            raw = this.deps.llm.chatJson
                ? await this.deps.llm.chatJson([...messages])
                : await this.deps.llm.chat([...messages]);
        }
        catch (err) {
            console.warn('[diary] llm failed:', err.message);
            return false;
        }
        const parsed = parseDiary(raw);
        const diaryText = parsed.diary ?? truncate(raw.trim(), 800);
        if (diaryText.length < 20)
            return false;
        await this.deps.memory.remember({
            kind: 'diary',
            content: diaryText,
            tags: ['diary', dayKey],
        });
        for (const strategy of parsed.strategies.slice(0, 2)) {
            const text = strategy.trim();
            if (text.length < 8)
                continue;
            await this.deps.memory.remember({
                kind: 'strategy',
                content: truncate(text, 200),
                tags: ['strategy', dayKey],
            });
        }
        return true;
    }
}
function parseDiary(raw) {
    const trimmed = raw.trim();
    const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
    const body = fenced ? fenced[1] : trimmed;
    try {
        const obj = JSON.parse(body);
        return {
            diary: typeof obj.diary === 'string' ? obj.diary.trim() : undefined,
            strategies: Array.isArray(obj.strategies)
                ? obj.strategies.filter((s) => typeof s === 'string')
                : [],
        };
    }
    catch {
        // Not JSON: keep the whole reply as the diary, no strategies.
        return { strategies: [] };
    }
}
export function localDayKey(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}
function truncate(s, max) {
    return s.length > max ? s.slice(0, max) + '…' : s;
}
