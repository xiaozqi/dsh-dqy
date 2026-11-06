import { appendFileSync } from 'node:fs';
export class NotificationService {
    sources;
    pipeline;
    recentCapacity;
    cancelSink;
    cancelLogPath;
    allowListener;
    failClosed;
    received = 0;
    allowed = 0;
    blocked = 0;
    canceled = 0;
    droppedBy = {};
    buffer = [];
    listeners = new Set();
    queue = Promise.resolve();
    unsubscribes = [];
    startedFlag = false;
    constructor(sources, pipeline, recentCapacity = 100, cancelSink, cancelLogPath, 
    // Optional side-channel: invoked exactly once per decision whose action
    // is 'allow'. Used by the autonomy loop to wake on new incoming messages.
    // Keeping this as a plain callback (not a domain port) avoids widening
    // NotificationPort for a single consumer.
    allowListener, 
    /**
     * A filter that throws must block instead of delivering the event. An
     * allowed event can wake the autonomy loop, so failing open here would let
     * a broken filter turn into an autonomous action.
     */
    failClosed = true) {
        this.sources = sources;
        this.pipeline = pipeline;
        this.recentCapacity = recentCapacity;
        this.cancelSink = cancelSink;
        this.cancelLogPath = cancelLogPath;
        this.allowListener = allowListener;
        this.failClosed = failClosed;
    }
    get started() {
        return this.startedFlag;
    }
    get connected() {
        return this.sources.some(source => source.connected);
    }
    async start() {
        if (this.startedFlag) {
            return;
        }
        this.startedFlag = true;
        for (const source of this.sources) {
            this.unsubscribes.push(source.subscribe(event => this.enqueue(event)));
            await source.start();
        }
    }
    async stop() {
        this.startedFlag = false;
        const unsubs = this.unsubscribes;
        this.unsubscribes = [];
        for (const unsub of unsubs) {
            try {
                unsub();
            }
            catch {
                /* unsubscribing a source must not block the others */
            }
        }
        for (const source of this.sources) {
            try {
                await source.stop();
            }
            catch {
                /* one source failing to stop must not block the others */
            }
        }
    }
    onEvent(cb) {
        this.listeners.add(cb);
        return () => {
            this.listeners.delete(cb);
        };
    }
    recent(limit = this.recentCapacity) {
        return this.buffer.slice(-limit);
    }
    stats() {
        return {
            received: this.received,
            allowed: this.allowed,
            blocked: this.blocked,
            canceled: this.canceled,
            droppedBy: { ...this.droppedBy },
        };
    }
    enqueue(event) {
        this.queue = this.queue
            .then(() => this.handle(event))
            .catch(() => { });
    }
    async handle(event) {
        this.received += 1;
        let decision;
        try {
            decision = await this.pipeline.decide(event);
        }
        catch (err) {
            // Fail closed: an exception in the filter chain is not evidence that the
            // notification is safe, and an allowed event can wake the autonomy loop.
            console.warn(`[notifications] filter chain failed: ${err.message}`);
            decision = this.failClosed
                ? { event, action: 'block', reason: 'pipeline-error' }
                : { event, action: 'allow', reason: 'pipeline-error' };
        }
        if (decision.action === 'allow') {
            this.allowed += 1;
            this.pushRecent(decision);
            if (this.allowListener) {
                try {
                    this.allowListener(decision.event);
                }
                catch {
                    // A listener failure must not break the notification pipeline.
                }
            }
        }
        else {
            this.blocked += 1;
            this.droppedBy[decision.reason] =
                (this.droppedBy[decision.reason] ?? 0) + 1;
            if (decision.event.id) {
                this.cancelSink?.pushCancel(decision.event.id);
                this.canceled += 1;
                this.appendCancelLog(decision);
            }
        }
        for (const cb of this.listeners) {
            try {
                cb(decision);
            }
            catch {
                /* a listener failure must not break the pipeline */
            }
        }
    }
    pushRecent(decision) {
        this.buffer.push(decision);
        if (this.buffer.length > this.recentCapacity) {
            this.buffer.shift();
        }
    }
    appendCancelLog(decision) {
        if (!this.cancelLogPath) {
            return;
        }
        try {
            appendFileSync(this.cancelLogPath, JSON.stringify({
                actor: 'plugin',
                key: decision.event.id,
                app: decision.event.app,
                title: decision.event.title,
                reason: decision.reason,
                matchedRule: decision.matchedRule ?? null,
                when: Date.now(),
            }) + '\n', 'utf8');
        }
        catch {
            /* logging a cancel must never break the pipeline */
        }
    }
}
