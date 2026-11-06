import type { NotificationDecision, NotificationEvent, NotificationFilter } from '../../domain/notification-types.js';
export declare class NotificationPipeline {
    private readonly filters;
    constructor(filters: readonly NotificationFilter[]);
    decide(event: NotificationEvent): Promise<NotificationDecision>;
}
