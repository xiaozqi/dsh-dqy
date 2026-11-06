export class NotificationPipeline {
    filters;
    constructor(filters) {
        this.filters = filters;
    }
    async decide(event) {
        for (const filter of this.filters) {
            const decision = await filter.apply(event);
            if (decision) {
                return decision;
            }
        }
        return { event, action: 'allow', reason: 'no filter matched' };
    }
}
