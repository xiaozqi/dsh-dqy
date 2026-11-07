import { DeviceError } from '../../domain/errors.js';
import { centerOf, findNode, sleep, waitFor } from '../../application/support/wait-for.js';
import { ensureDeviceReady } from '../../application/support/device-ready.js';
import { findBottomInput, headerShowsPeer, } from '../../application/support/chat-surface.js';
export const DOUYIN_PACKAGE = 'com.ss.android.ugc.aweme';
const INPUT_HINT = /发消息或按住说话/;
const SEND_BUTTON = /^发送$/;
/**
 * Sends one Douyin direct message by driving the real UI.
 *
 * The declarative recipe assumed it always starts on the message list and taps
 * 「消息」→ peer row. In practice the app often resumes straight into the DM
 * chat (that is exactly when a notification fires), so the recipe timed out at
 * the first tap. This sender detects the current surface first, and only
 * navigates when it is not already in the right conversation.
 */
export class DouyinDmSender {
    driver;
    constructor(driver) {
        this.driver = driver;
    }
    async send(input) {
        if (input.app !== DOUYIN_PACKAGE) {
            throw new DeviceError('DM_UNSUPPORTED', `DouyinDmSender cannot send for: ${input.app}`);
        }
        const peer = input.peer.trim();
        const reply = input.reply.trim();
        if (!peer || !reply) {
            throw new DeviceError('DM_BAD_INPUT', 'peer and reply must not be empty');
        }
        await this.driver.connect();
        await ensureDeviceReady(this.driver);
        await this.driver.openApp(DOUYIN_PACKAGE);
        await waitFor(async () => (await this.driver.foregroundApp()) === DOUYIN_PACKAGE ? true : null, { timeoutMs: 15000 });
        await sleep(1500);
        if (!(await this.isPeerChat(peer))) {
            await this.openPeerChat(peer);
        }
        // Navigation can fail silently; confirm the destination before typing.
        await this.assertPeerChat(peer);
        await this.typeAndSend(reply);
    }
    /** In the right conversation when the bottom input bar and top header both match. */
    async isPeerChat(peer) {
        const [observation, size] = await Promise.all([
            this.driver.observe(),
            this.driver.screenSize(),
        ]);
        const input = findBottomInput(observation, size, node => INPUT_HINT.test(node.text) ||
            INPUT_HINT.test(node.desc) ||
            node.className.includes('EditText'));
        if (!input) {
            return false;
        }
        return headerShowsPeer(observation, peer, size);
    }
    /** Hard gate: never type into a chat whose header names someone else. */
    async assertPeerChat(peer) {
        const [observation, size] = await Promise.all([
            this.driver.observe(),
            this.driver.screenSize(),
        ]);
        if (!headerShowsPeer(observation, peer, size)) {
            throw new DeviceError('DM_PEER_MISMATCH', `chat header does not show ${peer}; refusing to send`);
        }
    }
    async openPeerChat(peer) {
        // Navigate to the message tab, backing out of any open chat first.
        for (let attempt = 0; attempt < 3; attempt++) {
            const observation = await this.driver.observe();
            const tab = findNode(observation.roots, node => node.text === '消息' || node.desc.includes('消息，按钮'));
            if (tab) {
                await this.driver.tap(centerOf(tab));
                await sleep(1500);
                break;
            }
            await this.driver.pressKey('back');
            await sleep(1000);
        }
        let row = await this.findPeerRow(peer);
        if (!row) {
            // The conversation may sit below the fold; scroll the list down a few
            // times instead of failing the reply outright.
            const size = await this.driver.screenSize();
            const from = { x: Math.round(size.width / 2), y: Math.round(size.height * 0.75) };
            const to = { x: Math.round(size.width / 2), y: Math.round(size.height * 0.35) };
            for (let scroll = 0; scroll < 4 && !row; scroll++) {
                await this.driver.swipe(from, to, 400);
                await sleep(800);
                row = await this.findPeerRow(peer);
            }
        }
        if (!row) {
            throw new DeviceError('DM_PEER_NOT_FOUND', `cannot find a conversation named ${peer}`);
        }
        await this.driver.tap(centerOf(row));
        await sleep(1500);
    }
    async findPeerRow(peer) {
        return waitFor(async () => {
            const observation = await this.driver.observe();
            return findNode(observation.roots, node => (node.desc || '').includes(peer) ||
                (node.text || '').includes(peer));
        }, { timeoutMs: 4000 }).catch(() => null);
    }
    async typeAndSend(reply) {
        const inputNode = await waitFor(async () => {
            const observation = await this.driver.observe();
            return findNode(observation.roots, node => INPUT_HINT.test(node.text) ||
                INPUT_HINT.test(node.desc) ||
                node.className.includes('EditText'));
        }, { timeoutMs: 8000 });
        await this.driver.tap(centerOf(inputNode));
        await sleep(600);
        // Douyin's input is Chinese; route through the IME channel, not `input text`.
        await this.driver.inputChinese(reply);
        await sleep(800);
        const sendButton = await waitFor(async () => {
            const observation = await this.driver.observe();
            return findNode(observation.roots, node => SEND_BUTTON.test(node.text) || SEND_BUTTON.test(node.desc));
        }, { timeoutMs: 5000 }).then(node => node, () => null);
        if (sendButton) {
            await this.driver.tap(centerOf(sendButton));
        }
        else {
            await this.driver.pressKey('enter');
        }
        // Only report success when the text is visible in the conversation. Long
        // replies are truncated inside the bubble, so the fallback proof is that
        // the input box no longer holds the draft.
        const probe = reply.slice(0, 8);
        const confirmed = await waitFor(async () => {
            const observation = await this.driver.observe();
            const inBubble = findNode(observation.roots, node => (node.text || '').includes(probe));
            if (inBubble) {
                return true;
            }
            const draftStillThere = findNode(observation.roots, node => (node.className || '').includes('EditText') &&
                (node.text || '').includes(probe));
            return draftStillThere ? null : true;
        }, { timeoutMs: 6000 }).then(() => true, () => false);
        if (!confirmed) {
            throw new DeviceError('DM_SEND_UNCONFIRMED', 'reply was typed but not observed in the conversation');
        }
    }
}
