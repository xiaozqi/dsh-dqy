/**
 * Serializes whole UI flows, not just single driver calls.
 *
 * A QQ notification and a Douyin DM can arrive at the same moment. The phone
 * has one foreground, so interleaving the two flows makes each one tap into
 * the other's screen — the reply lands in the wrong place or times out. Every
 * outbound flow (QQ reply, Douyin DM send) runs through the same lock, so the
 * device is driven by one flow at a time.
 */
export declare class FlowLock {
    private tail;
    private running;
    get busy(): boolean;
    /** Runs `task` after every previously queued flow has finished. */
    run<T>(task: () => Promise<T>): Promise<T>;
}
