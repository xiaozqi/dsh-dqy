import type {
  NotificationDecision,
  NotificationEvent,
  NotificationFilter,
} from '../../domain/notification-types.js'

export class NotificationPipeline {
  constructor(private readonly filters: readonly NotificationFilter[]) {}

  async decide(event: NotificationEvent): Promise<NotificationDecision> {
    for (const filter of this.filters) {
      const decision = await filter.apply(event)
      if (decision) {
        return decision
      }
    }
    return { event, action: 'allow', reason: 'no filter matched' }
  }
}
