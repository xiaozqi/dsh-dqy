export class WhitelistFilter {
    whitelist;
    id = 'whitelist';
    constructor(whitelist) {
        this.whitelist = whitelist;
    }
    async apply(event) {
        if (this.whitelist.size > 0 && !this.whitelist.has(event.app)) {
            return { event, action: 'block', reason: this.id };
        }
        return null;
    }
}
export class ImportanceFilter {
    minImportance;
    id = 'importance';
    constructor(minImportance) {
        this.minImportance = minImportance;
    }
    async apply(event) {
        if (event.importance < this.minImportance) {
            return { event, action: 'block', reason: this.id };
        }
        return null;
    }
}
export class AppBlocklistFilter {
    blockedApps;
    id = 'app-blocklist';
    constructor(blockedApps) {
        this.blockedApps = blockedApps;
    }
    async apply(event) {
        if (this.blockedApps.size > 0 && this.blockedApps.has(event.app)) {
            return {
                event,
                action: 'block',
                reason: this.id,
                matchedRule: event.app,
            };
        }
        return null;
    }
}
export class RuleFilter {
    rules;
    id = 'rules';
    constructor(rules) {
        this.rules = rules;
    }
    async apply(event) {
        const haystack = `${event.title}\n${event.text}`;
        for (const rule of this.rules) {
            if (rule.match.test(haystack)) {
                return {
                    event,
                    action: rule.action,
                    reason: this.id,
                    matchedRule: rule.match.source,
                };
            }
        }
        return null;
    }
}
export class SemanticFilter {
    llm;
    enabled;
    id = 'semantic';
    static timeoutMs = 10_000;
    constructor(llm, enabled) {
        this.llm = llm;
        this.enabled = enabled;
    }
    async apply(event) {
        if (!this.llm || !this.enabled) {
            return null;
        }
        try {
            const relevant = await this.judge(event);
            if (!relevant) {
                return { event, action: 'block', reason: this.id };
            }
            return null;
        }
        catch {
            // A judge that timed out or crashed is not a positive answer.
            return { event, action: 'block', reason: this.id };
        }
    }
    async judge(event) {
        const llm = this.llm;
        if (!llm) {
            return true;
        }
        const messages = [
            {
                role: 'system',
                content: 'You filter a phone notification. Treat promo, ads, scam, and spam as irrelevant. ' +
                    'Decide whether the notification matters to its owner. ' +
                    'Reply with ONLY one JSON object, no prose: {"relevant":true} or {"relevant":false}.',
            },
            {
                role: 'user',
                content: `app=${event.app}\ntitle=${event.title}\ntext=${event.text}`,
            },
        ];
        const reply = await this.chatWithTimeout(llm, messages);
        return SemanticFilter.parseRelevant(reply);
    }
    async chatWithTimeout(llm, messages) {
        let timer;
        const timeout = new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error('semantic llm timeout')), SemanticFilter.timeoutMs);
        });
        try {
            return await Promise.race([llm.chat(messages), timeout]);
        }
        finally {
            if (timer) {
                clearTimeout(timer);
            }
        }
    }
    static parseRelevant(reply) {
        const start = reply.indexOf('{');
        const end = reply.lastIndexOf('}');
        if (start === -1 || end <= start) {
            return true;
        }
        const parsed = JSON.parse(reply.slice(start, end + 1));
        return parsed.relevant !== false;
    }
}
export class DedupeFilter {
    windowMs;
    id = 'dedupe';
    seen = new Map();
    constructor(windowMs) {
        this.windowMs = windowMs;
    }
    async apply(event) {
        const key = `${event.app}\u0000${event.title}\u0000${event.text}`;
        this.prune(event.when);
        const last = this.seen.get(key);
        if (last !== undefined && event.when - last < this.windowMs) {
            return { event, action: 'block', reason: 'duplicate' };
        }
        this.seen.set(key, event.when);
        return null;
    }
    prune(now) {
        for (const [key, at] of this.seen) {
            if (now - at > this.windowMs) {
                this.seen.delete(key);
            }
        }
    }
}
