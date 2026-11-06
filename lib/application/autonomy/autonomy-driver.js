export class AutonomyDriver {
    deps;
    busy = false;
    pending = null;
    lastResult = null;
    constructor(deps) {
        this.deps = deps;
    }
    get isBusy() {
        return this.busy;
    }
    get lastWake() {
        return this.lastResult;
    }
    start() {
        this.deps.scheduler.start();
    }
    stop() {
        this.deps.scheduler.stop();
    }
    // Unified entry: heartbeat fires this, events fire this. If a tick is
    // already running we remember ONE pending wake (heartbeat preferred over
    // event) and run it again as soon as the current tick finishes.
    wake(reason) {
        if (this.busy) {
            // Collapse: at most one queued wake. Heartbeat wins ties (it already
            // happened on its own clock; an extra heartbeat wake is noisier than
            // skipping a duplicate event).
            if (this.pending === null)
                this.pending = reason;
            return;
        }
        void this.runLocked();
    }
    // Notification event hook: only acts when wakeOnEvent is enabled.
    onAllowEvent() {
        if (!this.deps.config.wakeOnEvent)
            return;
        this.wake('event');
    }
    async runLocked() {
        this.busy = true;
        try {
            const result = await this.deps.loop.runOnce();
            this.lastResult = result;
            const next = this.computeNextWakeMs(result);
            this.deps.scheduler.scheduleNext(next);
        }
        catch (err) {
            console.warn('[autonomy-driver] runOnce threw:', err.message);
            this.deps.scheduler.scheduleNext(this.deps.config.fallbackWakeMs);
        }
        finally {
            this.busy = false;
            const queued = this.pending;
            this.pending = null;
            if (queued) {
                // Defer to next microtask so the current tick fully unwinds.
                queueMicrotask(() => this.wake(queued));
            }
        }
    }
    computeNextWakeMs(result) {
        const { minWakeMs, maxWakeMs, fallbackWakeMs } = this.deps.config;
        const raw = result.nextWakeMs;
        if (typeof raw !== 'number' || !Number.isFinite(raw)) {
            return fallbackWakeMs;
        }
        // Clamp whatever the LLM reported (including 0 / negatives) into
        // [min, max]. Missing/non-numeric self-report falls back.
        return Math.min(maxWakeMs, Math.max(minWakeMs, raw));
    }
}
