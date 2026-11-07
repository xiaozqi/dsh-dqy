import type { DirectMessageSender, DirectMessageSendInput } from '../../domain/ports/dm-sender.port.js';
import type { UiDriverPort } from '../../domain/ports/ui-driver.port.js';
export declare const DOUYIN_PACKAGE = "com.ss.android.ugc.aweme";
/**
 * Sends one Douyin direct message by driving the real UI.
 *
 * The declarative recipe assumed it always starts on the message list and taps
 * 「消息」→ peer row. In practice the app often resumes straight into the DM
 * chat (that is exactly when a notification fires), so the recipe timed out at
 * the first tap. This sender detects the current surface first, and only
 * navigates when it is not already in the right conversation.
 */
export declare class DouyinDmSender implements DirectMessageSender {
    private readonly driver;
    constructor(driver: UiDriverPort);
    send(input: DirectMessageSendInput): Promise<void>;
    /** In the right conversation when the bottom input bar and top header both match. */
    private isPeerChat;
    /** Hard gate: never type into a chat whose header names someone else. */
    private assertPeerChat;
    private openPeerChat;
    private findPeerRow;
    private typeAndSend;
}
