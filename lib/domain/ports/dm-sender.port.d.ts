export interface DirectMessageSendInput {
    app: string;
    peer: string;
    reply: string;
}
export interface DirectMessageSender {
    send(input: DirectMessageSendInput): Promise<void>;
}
