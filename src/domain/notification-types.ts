export interface NotificationEvent {
  id: string
  app: string
  title: string
  text: string
  when: number
  importance: number
  source: string
}

export interface NotificationDecision {
  event: NotificationEvent
  action: 'allow' | 'block'
  reason: string
  matchedRule?: string
}

export interface NotificationFilter {
  id: string
  apply(event: NotificationEvent): Promise<NotificationDecision | null>
}
