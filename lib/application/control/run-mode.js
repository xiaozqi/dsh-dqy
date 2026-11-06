const STORE_KEY = 'run-mode';
// Safe defaults: nothing transmits until the user explicitly enables it, and
// dry run stays on so the first real sessions only log intended replies.
const DEFAULT_SNAPSHOT = {
    enabled: false,
    dryRun: true,
    halted: false,
};
export class RunMode {
    store;
    guard;
    state;
    constructor(store, guard, initial = DEFAULT_SNAPSHOT) {
        this.store = store;
        this.guard = guard;
        // Persisted state wins after the first manual change; the supplied initial
        // snapshot is only used when no state file exists yet.
        this.state = store.load(STORE_KEY, initial);
    }
    snapshot() {
        return { ...this.state };
    }
    gate(message) {
        if (this.state.halted) {
            return { verdict: 'block', reasons: ['emergency halt is active'] };
        }
        const violations = this.guard.inspect(message);
        if (violations.length > 0) {
            return { verdict: 'block', reasons: violations };
        }
        if (!this.state.enabled) {
            return { verdict: 'block', reasons: ['auto send is disabled'] };
        }
        if (this.state.dryRun) {
            return { verdict: 'dry-run', reasons: ['dry run mode'] };
        }
        return { verdict: 'send', reasons: [] };
    }
    enable() {
        this.update({ enabled: true });
    }
    disable() {
        this.update({ enabled: false });
    }
    setDryRun(on) {
        this.update({ dryRun: on });
    }
    halt() {
        // Halt latches and also flips the master switch off.
        this.update({ halted: true, enabled: false });
    }
    resume() {
        // Resume clears the latch but does not re-enable sending by itself.
        this.update({ halted: false });
    }
    update(patch) {
        this.state = { ...this.state, ...patch };
        this.store.save(STORE_KEY, this.state);
    }
}
