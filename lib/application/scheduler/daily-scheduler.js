export class DailyScheduler {
    deps;
    timer = null;
    fired = new Map();
    history = [];
    constructor(deps) {
        this.deps = deps;
    }
    start() {
        if (this.timer)
            return;
        const interval = this.deps.tickIntervalMs ?? 30000;
        this.timer = setInterval(() => {
            void this.tick();
        }, interval);
    }
    stop() {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
    }
    listHistory() {
        return [...this.history];
    }
    listPlans() {
        return [...this.deps.plans];
    }
    async tick() {
        const now = new Date();
        const dateKey = now.toISOString().slice(0, 10);
        for (const plan of this.deps.plans) {
            if (!plan.enabled)
                continue;
            if (this.fired.get(plan.app) === dateKey)
                continue;
            if (now.getHours() !== plan.hour ||
                now.getMinutes() !== plan.minute) {
                continue;
            }
            this.fired.set(plan.app, dateKey);
            try {
                await this.deps.run(plan);
                this.history.push({
                    app: plan.app,
                    ranAt: now.toISOString(),
                    status: 'success',
                    detail: 'scheduled run finished',
                });
            }
            catch (err) {
                this.history.push({
                    app: plan.app,
                    ranAt: now.toISOString(),
                    status: 'failed',
                    detail: err.message,
                });
            }
        }
    }
}
