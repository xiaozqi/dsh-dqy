export class DefaultAutonomyPolicy {
    auto = new Set();
    forbidden = new Set();
    guardEnabled;
    constructor(cfg) {
        this.guardEnabled = cfg.guardEnabled;
        for (const a of cfg.autoActions)
            this.auto.add(normalize(a));
        for (const f of cfg.forbiddenActions)
            this.forbidden.add(normalize(f));
    }
    classify(app, capability, method) {
        if (!this.guardEnabled)
            return 'confirm';
        const full = normalize(`${app}/${capability}/${method}`);
        const short = normalize(`${capability}/${method}`);
        // Both "app/capability/method" and "capability/method" keys are honored,
        // so a rule like "message/sendMessage" applies across every adapter.
        if (this.forbidden.has(full) || this.forbidden.has(short))
            return 'confirm';
        if (this.auto.has(full) || this.auto.has(short))
            return 'auto';
        return 'confirm';
    }
}
function normalize(key) {
    return key.trim().toLowerCase();
}
