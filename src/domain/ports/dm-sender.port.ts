// Output port that actually performs the platform UI send. The watch pipeline
// depends on this abstraction; the recipe-based implementation is wired in the
// composition root, so the pipeline never knows about selectors or the driver.
export interface DirectMessageSendInput {
  app: string
  peer: string
  reply: string
}

export interface DirectMessageSender {
  send(input: DirectMessageSendInput): Promise<void>
}
