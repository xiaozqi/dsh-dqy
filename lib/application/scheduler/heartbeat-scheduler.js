export class HeartbeatScheduler {
    deps;
    timer = null;
    nextDelayMs;
    constructor(deps) {
        this.deps = deps;
        this.nextDelayMs = deps.initialIntervalMs;
    }
    start() {
        if (this.timer)
            return;
        this.arm(this.nextDelayMs);
    }
    stop() {
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
        }
    }
    get running() {
        return this.timer !== null;
    }
    // Re-arm the next wake after `ms`. Safe to call while running; cancels the
    // pending timer and schedules a fresh one.
    scheduleNext(ms) {
        this.nextDelayMs = ms;
        if (!this.timer)
            return;
        clearTimeout(this.timer);
        this.arm(ms);
    }
    arm(ms) {
        this.timer = setTimeout(() => {
            void this.safeTick();
        }, ms);
    }
    async safeTick() {
        // If we were stopped between firing and running, bail out.
        if (!this.timer)
            return;
        try {
            await this.deps.onTick();
        }
        catch (err) {
            console.warn('[heartbeat] tick failed:', err.message);
        }
        // Re-arm with the current configured delay. The onTick handler (the
        // AutonomyDriver) should have called scheduleNext() already with the
        // post-tick delay; if it didn't, we keep the previous delay.
        if (this.timer) {
            this.arm(this.nextDelayMs);
        }
    }
}
