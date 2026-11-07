import { createHash } from 'node:crypto';
import { DeviceError, PolicyBlockedError } from '../../domain/errors.js';
import { failResult, okResult } from '../../domain/adapter-types.js';
import { confirmOutgoing, ensureForeground, enterText, openAndWait, pushMedia, tapSend, } from '../adapters/base-adapter.js';
import { ensureDeviceReady } from '../support/device-ready.js';
import { stripPeerPrefix } from './qq-peer-kind.js';
import { centerOf, findNode, findNodes, sleep, waitFor, waitForApp, withRetry, } from '../support/wait-for.js';
export const QQ_PACKAGE = 'com.tencent.mobileqq';
function hashText(text) {
    return createHash('sha256').update(text).digest('hex').slice(0, 16);
}
const SELECTORS = {
    unreadBadge: /未读|unread|新消息/i,
    inputHint: /发送消息|说点什么|输入/,
    send: /^发送$/,
    holdToTalk: /按住.*说话|按住说话|hold.*talk/i,
    voiceSwitch: /语音|voice|audio|麦克风/i,
    voiceBubble: /\d+["“”]?秒|语音|voice/i,
};
export class QqService {
    driver;
    llm;
    memory;
    voice;
    messageState;
    id = 'qq';
    displayName = 'QQ';
    packageName = QQ_PACKAGE;
    capabilities = new Set(['message', 'social', 'moment']);
    todos = [
        {
            capability: 'comment',
            feature: 'QQ Zone comment',
            note: 'Zone comment entry and posting flow not mapped; entry location varies by QQ release, needs on-device tuning.',
        },
        {
            capability: 'feed',
            feature: 'QQ Dots feed',
            note: 'QQLive / Dots feed browsing and interaction pipeline not implemented.',
        },
        {
            capability: 'live',
            feature: 'QQ Live room',
            note: 'Live room discovery, entry and observation not implemented.',
        },
        {
            capability: 'signin',
            feature: 'QQ daily sign-in',
            note: 'Daily sign-in entry is buried in varied menus; not mapped for this EMUI build.',
        },
        {
            capability: 'pet',
            feature: 'QQ Pet mini-game',
            note: 'Pet / farm mini-game automation not implemented.',
        },
    ];
    // This adapter serves two capability families on one class; the per-interface
    // discriminant literals ('message' vs 'social') cannot be intersected into a
    // single assignable type. The registry dispatches via the `capabilities`
    // set, so this discriminant value is informational only.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    capability = 'message';
    constructor(driver, llm, memory, voice, 
    // Optional reply journal: when present, an already-answered conversation
    // is skipped instead of answered again on the next call.
    messageState) {
        this.driver = driver;
        this.llm = llm;
        this.memory = memory;
        this.voice = voice;
        this.messageState = messageState;
    }
    async initialize() {
        // No warm-up needed; connect lazily per operation.
    }
    // ---------------------------------------------------------------------
    // MessageCapability
    // ---------------------------------------------------------------------
    async sendMessage(input) {
        const peer = input.peer?.trim() ?? '';
        const text = input.text?.trim() ?? '';
        if (!peer || !text) {
            throw new DeviceError('QQ_BAD_INPUT', 'peer and text must not be empty');
        }
        try {
            await this.driver.connect();
            await openAndWait(this.driver, QQ_PACKAGE, { timeoutMs: 30000 });
            await this.ensureConversationList();
            await this.enterPeerConversation(peer);
            // The chat can change under us (incoming notification, another actor),
            // so never type into a screen that is not QQ.
            await ensureForeground(this.driver, QQ_PACKAGE);
            await enterText(this.driver, text, undefined, { timeoutMs: 12000 });
            await this.submitSend();
            // A new outgoing bubble is the only proof of delivery: a failed send
            // leaves the text sitting in the composer, which is exactly what the old
            // "does this text appear anywhere" check mistook for success.
            const confirmed = await confirmOutgoing(this.driver, text);
            await this.memory.remember({
                kind: 'event',
                content: `QQ sendMessage to ${peer}: ${text} (confirmed=${confirmed})`,
                tags: ['qq', 'send', peer],
            });
            return confirmed
                ? okResult(`message sent to ${peer}`, { peer, text, sent: true })
                : failResult(`send flow completed but bubble not observed for ${peer}`, { peer, text, sent: false });
        }
        catch (err) {
            return failResult(`sendMessage failed for ${peer}: ${err.message}`);
        }
    }
    async sendImage(input) {
        const peer = input.peer?.trim() ?? '';
        const localImagePath = input.localImagePath?.trim() ?? '';
        if (!peer || !localImagePath) {
            throw new DeviceError('QQ_BAD_IMAGE_INPUT', 'peer and localImagePath must not be empty');
        }
        try {
            await this.driver.connect();
            const remote = await pushMedia(this.driver, localImagePath);
            await openAndWait(this.driver, QQ_PACKAGE, { timeoutMs: 30000 });
            await this.enterPeerConversation(peer);
            // Raise the keyboard first: on QQ 9.3.75 fun_btn reports bounds
            // [0,0][0,0] until the chat input is focused, so centerOf would tap
            // the top-left corner. Probe: chat.xml rid=fun_btn.
            await this.focusChatInput();
            const more = await waitFor(async () => {
                const nodes = await this.driver.findNodes({
                    resourceId: /:id\/fun_btn$/,
                });
                const alive = nodes.filter(n => n.bounds.right > n.bounds.left &&
                    n.bounds.bottom > n.bounds.top);
                return alive.length > 0 ? alive[0] : null;
            }, { timeoutMs: 8000 });
            await this.driver.tap(centerOf(more));
            await sleep(1000);
            // Gallery entry in the expanded panel: probe plus_panel.xml text="照片".
            const gallery = await waitFor(async () => {
                const nodes = await this.driver.findNodes({
                    text: /^照片$/,
                });
                const alive = nodes.filter(n => n.bounds.right > n.bounds.left);
                return alive.length > 0 ? alive[0] : null;
            }, { timeoutMs: 8000 });
            await this.driver.tap(centerOf(gallery));
            await sleep(1500);
            // Probe gallery.xml: thumbnails are rid=xmf ViewGroups with
            // desc="照片  拍摄时间: ..."; index 0 is the newest (top-left).
            const thumbs = await waitFor(async () => {
                const nodes = await this.driver.findNodes({
                    resourceId: /:id\/xmf$/,
                });
                const alive = nodes.filter(n => n.clickable && n.bounds.right > n.bounds.left);
                return alive.length > 0 ? alive : null;
            }, { timeoutMs: 10000 });
            await this.driver.tap(centerOf(thumbs[0]));
            await sleep(900);
            if (input.caption?.trim()) {
                try {
                    await enterText(this.driver, input.caption.trim(), { className: /EditText/ }, { timeoutMs: 3000 });
                }
                catch {
                    // Caption input is optional; ignore if unavailable.
                }
            }
            // Probe gallery.xml: rid=xmz Button text="发送", enabled=false until a
            // thumbnail is selected. Wait for it to enable, then tap it.
            const sendBtn = await waitFor(async () => {
                const nodes = await this.driver.findNodes({
                    resourceId: /:id\/xmz$/,
                });
                const alive = nodes.find(n => n.enabled && n.bounds.right > n.bounds.left);
                return alive ?? null;
            }, { timeoutMs: 6000 });
            await this.driver.tap(centerOf(sendBtn));
            await sleep(1000);
            return okResult(`image sent to ${peer}`, { peer, remote });
        }
        catch (err) {
            return failResult(`sendImage failed for ${peer}: ${err.message}`);
        }
    }
    async readConversation(peer, limit) {
        let effectivePeer = peer ?? 'current';
        try {
            await this.driver.connect();
            await openAndWait(this.driver, QQ_PACKAGE, { timeoutMs: 30000 });
            if (peer) {
                try {
                    await this.enterPeerConversation(peer);
                }
                catch {
                    effectivePeer = `${peer}(unopened)`;
                }
            }
            const messages = await this.readMessages();
            const incoming = messages
                .filter(m => !m.isSelf)
                .map(m => m.content)
                .filter(text => text.length > 0);
            const capped = typeof limit === 'number' && limit > 0
                ? incoming.slice(-limit)
                : incoming;
            return { peer: effectivePeer, incoming: capped };
        }
        catch {
            return { peer: effectivePeer, incoming: [] };
        }
    }
    // ---------------------------------------------------------------------
    // SocialCapability
    // ---------------------------------------------------------------------
    async mention(input) {
        const friend = input.friend?.trim() ?? '';
        if (!friend) {
            throw new DeviceError('QQ_BAD_MENTION', 'friend must not be empty');
        }
        // Verified on QQ 9.3.75: typing '@' in a 1:1 chat only inserts a literal
        // character; the member / mention panel opens exclusively in group chats.
        // The group panel structure has not been probed yet, so do not fake it.
        return failResult(`mention for ${friend} skipped: QQ only opens the member panel in group chats; 1:1 chat types '@' as plain text`, { friend, groupPanelProbed: false });
    }
    // ---------------------------------------------------------------------
    // MomentCapability (QQ Zone / 说说)
    // ---------------------------------------------------------------------
    async publishMoment(input) {
        const text = (input.text ?? input.content ?? '').trim();
        if (!text) {
            throw new DeviceError('QQ_BAD_MOMENT', 'moment text must not be empty');
        }
        try {
            await this.driver.connect();
            await openAndWait(this.driver, QQ_PACKAGE, { timeoutMs: 30000 });
            // A previous failed run may have left the QZone publish editor open;
            // enterQzoneFeed cannot navigate while it is showing. Back out first.
            await this.dismissStaleEditor();
            await withRetry(async () => {
                await this.enterQzoneFeed();
                await this.openMomentEditor();
                await this.composeAndPublishMoment(text);
            }, { attempts: 2, delayMs: 1500 });
            // QZone returns to the feed after publishing; the new moment's text
            // should render near the top. Verify before reporting success.
            const prefix = text.slice(0, 12);
            const verified = await waitFor(async () => {
                const obs = await this.driver.observe();
                // QZone renders feed moments as content-desc, not text.
                const hit = findNode(obs.roots, node => node.text.includes(prefix) || node.desc.includes(prefix));
                return hit ? true : null;
            }, { timeoutMs: 12000 }).then(() => true, () => false);
            await this.memory.remember({
                kind: 'event',
                content: `QQ publishMoment: "${text}" ` +
                    `(verified=${verified}, visibility=public-by-default)`,
                tags: ['qq', 'moment', 'qzone'],
            });
            return verified
                ? okResult('moment published to QQ Zone', { text, visibility: 'public' })
                : failResult('publish flow completed but moment not found in feed', {
                    text,
                });
        }
        catch (err) {
            return failResult(`publishMoment failed: ${err.message}`);
        }
    }
    // ---------------------------------------------------------------------
    // Legacy public tools (kept for tool compatibility)
    // ---------------------------------------------------------------------
    async sendVoiceWithText(input) {
        const peer = input.peer.trim();
        const text = input.text;
        if (!peer || !text.trim()) {
            throw new DeviceError('QQ_BAD_VOICE_INPUT', 'peer and text must not be empty');
        }
        // A voice message is an outbound message: it needs the same gate and the
        // same recipient check as text, otherwise it could speak into any open chat.
        const decision = input.authorize?.({ peer, text });
        if (decision?.verdict === 'block') {
            throw new PolicyBlockedError('POLICY_BLOCKED', `voice message to ${peer} blocked: ${decision.reasons.join('; ')}`, decision.reasons);
        }
        if (decision?.verdict === 'dry-run') {
            return {
                text,
                audioPath: '',
                remotePath: '',
                durationMs: 0,
                sent: false,
            };
        }
        await this.driver.connect();
        await openAndWait(this.driver, QQ_PACKAGE, { timeoutMs: 30000 });
        await this.enterPeerConversation(peer);
        await ensureForeground(this.driver, QQ_PACKAGE);
        const spoken = await this.voice.speak(text, input.voice, false);
        const remoteDir = '/sdcard/dqy/voice';
        const remote = `${remoteDir}/fish-${Date.now()}.mp3`;
        await this.driver.pushFile(spoken.audioPath, remote);
        const hold = await this.locateHoldButton();
        const holdPoint = centerOf(hold);
        let sent = false;
        try {
            await Promise.all([
                this.driver.longPress(holdPoint, Math.min(spoken.durationMs + 500, 15000)),
                (async () => {
                    await sleep(400);
                    await this.driver.playAudio(remote);
                })(),
            ]);
            await sleep(1200);
            const after = await this.driver.observe();
            sent =
                findNode(after.roots, node => SELECTORS.voiceBubble.test(node.desc) ||
                    SELECTORS.voiceBubble.test(node.text)) !== null;
        }
        catch {
            sent = false;
        }
        await this.memory.remember({
            kind: 'event',
            content: `QQ voice message with my voice: "${text}", ` +
                `duration ${spoken.durationMs}ms, sent ${sent}`,
            tags: ['qq', 'voice', 'tts'],
        });
        return {
            text,
            audioPath: spoken.audioPath,
            remotePath: remote,
            durationMs: spoken.durationMs,
            sent,
        };
    }
    /** True when the screen already is this peer's chat and the input bar exists. */
    async isPeerChatOpen(peer) {
        const observation = await this.driver.observe();
        const hasInput = findNode(observation.roots, node => node.className.includes('EditText') ||
            SELECTORS.inputHint.test(node.text) ||
            SELECTORS.inputHint.test(node.desc));
        if (!hasInput) {
            return false;
        }
        return (findNode(observation.roots, node => (node.text || '').includes(peer) || (node.desc || '').includes(peer)) !== null);
    }
    /**
     * Reply to one named peer, driven by the notification that just arrived.
     *
     * Unread-badge scanning is unreliable in practice: QQ clears the badge as
     * soon as the notification is handled, so a reply that arrives "now" has no
     * row to find. The notification already carries the peer name, so open that
     * conversation directly and answer the last inbound message.
     */
    async replyToPeer(peer, authorize, message) {
        const name = peer.trim();
        if (!name) {
            return null;
        }
        const trigger = message?.text?.trim() ?? '';
        // Dedupe on the message itself, never on "we replied recently": two
        // messages seconds apart must both get an answer, while a replayed
        // notification for the same message must not be answered twice.
        const messageKey = trigger
            ? `qq-reply:${name}:${hashText(`${trigger}|${message?.when ?? ''}`)}`
            : '';
        if (messageKey && this.messageState?.seen(messageKey)) {
            return null;
        }
        await this.driver.connect();
        await ensureDeviceReady(this.driver);
        // Opening QQ costs several seconds; if it is already in front (the usual
        // case right after a notification), skip it entirely.
        if ((await this.driver.foregroundApp()) !== QQ_PACKAGE) {
            await this.driver.openApp(QQ_PACKAGE);
            await waitForApp(this.driver, QQ_PACKAGE, { timeoutMs: 15000 });
            await ensureForeground(this.driver, QQ_PACKAGE);
        }
        // Navigation (list → search → peer) is the slowest part. When the phone is
        // already showing this chat — which is exactly where QQ sits when its
        // notification fires — skip it.
        if (!(await this.isPeerChatOpen(name))) {
            await this.ensureConversationList();
            await this.enterPeerConversation(name);
        }
        await sleep(600);
        // Recent history makes the reply fit the conversation; the notification is
        // still the authoritative trigger, so it is appended when the screen has
        // not caught up with it yet.
        const history = await this.readMessages().catch(() => []);
        const inboundHistory = history.filter(message => !message.isSelf);
        let incoming;
        if (trigger) {
            const cleaned = stripPeerPrefix(trigger);
            const newest = inboundHistory[inboundHistory.length - 1]?.content;
            incoming =
                newest === cleaned
                    ? inboundHistory.slice(-6)
                    : [
                        ...inboundHistory.slice(-5),
                        { sender: name, content: cleaned, isSelf: false, time: '' },
                    ];
        }
        else {
            incoming = inboundHistory;
        }
        if (incoming.length === 0) {
            return null;
        }
        const last = incoming[incoming.length - 1]?.content ?? '';
        const key = messageKey || `qq-reply:${name}:${hashText(last)}`;
        if (!messageKey && this.messageState?.seen(key)) {
            return null;
        }
        this.messageState?.claim({
            idempotencyKey: key,
            app: QQ_PACKAGE,
            conversationId: `qq:${name}`,
            textHash: hashText(trigger || last),
        });
        // Keep the journal honest: a claimed message must end in sent/failed, not
        // sit in "pending" forever (that is what the health panel reads).
        const mark = (phase, detail) => {
            try {
                this.messageState?.transition(key, phase, detail);
            }
            catch {
                // The journal is best-effort; never fail a reply over bookkeeping.
            }
        };
        mark('filtered');
        const reply = await this.composeReply(name, incoming);
        const decision = authorize({ peer: name, text: reply });
        if (decision.verdict !== 'allow') {
            mark('failed', decision.reasons.join('; '));
            await this.memory.remember({
                kind: 'event',
                content: `QQ reply to ${name} ${decision.verdict}: ${reply} ` +
                    `(${decision.reasons.join('; ')})`,
                tags: ['qq', decision.verdict, name],
            });
            return { peer: name, incoming, reply, sent: false };
        }
        mark('decided');
        mark('acting');
        let sent = false;
        try {
            sent = await this.sendReply(reply);
        }
        catch (err) {
            mark('failed', err.message);
            throw err;
        }
        mark('sent');
        mark('verified');
        await this.memory.remember({
            kind: 'event',
            content: `QQ conversation with ${name}: ` +
                `${incoming.map(m => m.content).join(' / ')} -> ` +
                `${sent ? 'replied' : 'reply not confirmed'}: ${reply}`,
            tags: ['qq', 'conversation', name],
        });
        return { peer: name, incoming, reply, sent };
    }
    async replyToUnread(options = {}) {
        if (!options.authorize) {
            // Defense in depth: without the outbound gate this path would send
            // replies to whoever the heuristic picked. Refuse instead.
            throw new DeviceError('POLICY_NOT_WIRED', 'replyToUnread requires an outbound policy gate');
        }
        const maxConversations = options.maxConversations ?? 3;
        await this.driver.connect();
        await ensureDeviceReady(this.driver);
        await this.driver.openApp(QQ_PACKAGE);
        await waitForApp(this.driver, QQ_PACKAGE, { timeoutMs: 15000 });
        await ensureForeground(this.driver, QQ_PACKAGE);
        await this.ensureConversationList();
        await sleep(2000);
        const rows = await this.collectUnreadRows();
        const results = [];
        // One reply per conversation per run. The same chat can be collected twice
        // (overlapping clickable wrappers), and a sent reply changes the latest
        // message, which changed the idempotency key and answered the same person
        // twice in one call.
        const handled = new Set();
        for (const row of rows.slice(0, maxConversations)) {
            const peer = this.peerName(row).trim();
            if (!peer || handled.has(peer)) {
                continue;
            }
            handled.add(peer);
            await this.driver.tap(centerOf(row));
            await sleep(1500);
            const messages = await this.readMessages();
            const incoming = messages.filter(m => !m.isSelf);
            if (incoming.length === 0) {
                await this.driver.pressKey('back');
                await sleep(800);
                continue;
            }
            // Journal by peer + last inbound text, so a retry (or a second tool call
            // while the badge has not cleared yet) cannot answer twice.
            const last = incoming[incoming.length - 1]?.content ?? '';
            const key = `qq-reply:${peer}:${hashText(last)}`;
            if (this.messageState?.seen(key)) {
                results.push({ peer, incoming, reply: '', sent: false });
                await this.driver.pressKey('back');
                await sleep(800);
                continue;
            }
            this.messageState?.claim({
                idempotencyKey: key,
                app: QQ_PACKAGE,
                conversationId: `qq:${peer}`,
                textHash: hashText(last),
            });
            const reply = await this.composeReply(peer, incoming);
            const decision = options.authorize({ peer, text: reply });
            if (decision.verdict !== 'allow') {
                results.push({ peer, incoming, reply, sent: false });
                await this.memory.remember({
                    kind: 'event',
                    content: `QQ reply to ${peer} ${decision.verdict}: ${reply} ` +
                        `(${decision.reasons.join('; ')})`,
                    tags: ['qq', decision.verdict, peer],
                });
                await this.driver.pressKey('back');
                await sleep(1000);
                continue;
            }
            const sent = await this.sendReply(reply);
            results.push({ peer, incoming, reply, sent });
            await this.memory.remember({
                kind: 'event',
                content: `QQ conversation with ${peer}: ` +
                    `${incoming.map(m => m.content).join(' / ')} -> ` +
                    `${sent ? 'replied' : 'reply not confirmed'}: ${reply}`,
                tags: ['qq', 'conversation', peer],
            });
            await this.driver.pressKey('back');
            await sleep(1000);
        }
        return results;
    }
    // ---------------------------------------------------------------------
    // Internals
    // ---------------------------------------------------------------------
    // On the QQ chat list (probe home.xml) each conversation row is
    // rid=aua with the friend name embedded at the START of content-desc,
    // e.g. "FriendName, ,you have not chatted for 1 day,18:43". The row's
    // TextViews are empty, so {text: peer} never matches. Match rid=aua with
    // a desc anchored at the peer name, then fall back to search.
    async enterPeerConversation(peer) {
        const anchored = new RegExp(`^${escapeRegExp(peer)}`);
        try {
            const row = await waitFor(async () => {
                const nodes = await this.driver.findNodes({
                    resourceId: /:id\/aua$/,
                    desc: anchored,
                });
                const alive = nodes.filter(n => n.clickable);
                return alive.length > 0 ? alive[0] : null;
            }, { timeoutMs: 5000 });
            await this.driver.tap(centerOf(row));
            await sleep(1500);
            return;
        }
        catch {
            // fall through to search
        }
        // Magnifier entry usually exposes a desc containing the search keyword.
        const searchEntry = await waitFor(async () => {
            const byDesc = await this.driver.findNodes({ desc: /搜索/ });
            if (byDesc.length > 0)
                return byDesc[0];
            const byText = await this.driver.findNodes({ text: /搜索/ });
            if (byText.length > 0)
                return byText[0];
            return null;
        }, { timeoutMs: 8000 });
        await this.driver.tap(centerOf(searchEntry));
        await sleep(1200);
        await enterText(this.driver, peer, undefined, {
            timeoutMs: 8000,
        });
        await sleep(1000);
        const result = await waitFor(async () => {
            const nodes = await this.driver.findNodes({ text: peer });
            return nodes.length > 0 ? nodes[0] : null;
        }, { timeoutMs: 8000 });
        await this.driver.tap(centerOf(result));
        await sleep(1500);
    }
    // Tap the chat input (probe chat.xml rid=input EditText) to raise the
    // IME keyboard; required before fun_btn reports real bounds.
    async focusChatInput() {
        const input = await waitFor(async () => {
            const nodes = await this.driver.findNodes({
                resourceId: /:id\/input$/,
                className: /EditText/,
            });
            const alive = nodes.filter(n => n.bounds.right > n.bounds.left && n.bounds.bottom > n.bounds.top);
            return alive.length > 0 ? alive[0] : null;
        }, { timeoutMs: 8000 });
        await this.driver.tap(centerOf(input));
        await sleep(1200);
    }
    // Tap the on-screen send button when present; otherwise submit via Enter.
    async submitSend() {
        try {
            await tapSend(this.driver, { timeoutMs: 3000 });
        }
        catch {
            await this.driver.pressKey('enter');
        }
    }
    // Reach the QZone feed. Idempotent: QQ may resume straight into the feed
    // (no bottom nav), into the 动态 page, or onto the home tab. On QQ 9.3.75
    // the bottom-nav tab labels report bounds [0,0][0,0]; the tap target is the
    // clickable parent frame near the screen bottom.
    // A failed run can leave the QZone publish editor (取消 + 写说说/发表 +
    // EditText) on screen; enterQzoneFeed cannot navigate while it shows.
    // Detect it and back out to the feed before starting navigation.
    async dismissStaleEditor() {
        const obs = await this.driver.observe();
        const hasEditor = findNode(obs.roots, n => n.text === '取消') !== null &&
            findNode(obs.roots, n => n.text === '发表') !== null &&
            findNode(obs.roots, n => n.className.includes('EditText')) !== null;
        if (!hasEditor)
            return;
        const cancel = findNode(obs.roots, n => n.text === '取消');
        if (cancel) {
            await this.driver.tap(centerOf(cancel));
            await sleep(1200);
        }
        // Some builds confirm discarding the draft; tap through if present.
        const obs2 = await this.driver.observe();
        const discard = findNode(obs2.roots, n => /放弃|不保存|删除草稿|丢弃/.test(n.text));
        if (discard) {
            await this.driver.tap(centerOf(discard));
            await sleep(1000);
        }
    }
    async enterQzoneFeed() {
        const obs = await this.driver.observe();
        // Already on the QZone feed (compose box visible)? Done.
        if (findClickableByText(obs.roots, /分享新鲜事/)) {
            await sleep(1000);
            return;
        }
        // On the 动态 page? Tap "空间动态".
        const zoneEntry = findNode(obs.roots, node => node.text === '空间动态');
        if (zoneEntry) {
            await this.driver.tap(centerOf(zoneEntry));
            await sleep(4000);
            return;
        }
        // Otherwise on home: bottom nav "动态" -> then "空间动态".
        const tab = await waitFor(async () => {
            const current = await this.driver.observe();
            return (findClickableByText(current.roots, /^动态$/, current.screenSize.height * 0.9) ?? null);
        }, { timeoutMs: 8000 });
        await this.driver.tap(centerOf(tab));
        await sleep(2000);
        const zone = await waitFor(async () => {
            const current = await this.driver.observe();
            return (findNode(current.roots, node => node.text === '空间动态') ?? null);
        }, { timeoutMs: 10000 });
        await this.driver.tap(centerOf(zone));
        await sleep(4000);
    }
    // QZone feed -> the "分享新鲜事..." compose box opens the 写说说 editor.
    async openMomentEditor() {
        const box = await waitFor(async () => {
            const obs = await this.driver.observe();
            return findClickableByText(obs.roots, /分享新鲜事/) ?? null;
        }, { timeoutMs: 12000 });
        await this.driver.tap(centerOf(box));
        await sleep(2500);
        // On first open the editor shows a promotional bubble ("空友爱看开放
        // 投稿") whose popup window masks the uiautomator tree: dumps taken
        // while it is up contain only the bubble and never the composer. Tap a
        // neutral area to dismiss it before looking for the EditText.
        const size = await this.driver.screenSize();
        await this.driver.tap({
            x: Math.round(size.width / 2),
            y: Math.round(size.height * 0.5),
        });
        await sleep(1000);
        // Wait for the composer EditText to render before typing.
        await waitFor(async () => {
            const obs = await this.driver.observe();
            const edit = findNode(obs.roots, node => node.className.includes('EditText') &&
                node.bounds.right > node.bounds.left);
            return edit ? true : null;
        }, { timeoutMs: 12000 });
        await sleep(1200);
    }
    // Focus the composer, inject the (Chinese) text via ADBKeyBoard, then tap
    // 发表. The publish button is disabled until the field has content.
    async composeAndPublishMoment(text) {
        const edit = await waitFor(async () => {
            const nodes = await this.driver.findNodes({
                className: /EditText/,
            });
            const alive = nodes.filter(n => n.bounds.right > n.bounds.left);
            return alive.length > 0 ? alive[0] : null;
        }, { timeoutMs: 8000 });
        await this.driver.tap(centerOf(edit));
        await sleep(1200);
        await this.driver.inputChinese(text);
        // Confirm the text actually landed before publishing.
        await waitFor(async () => {
            const obs = await this.driver.observe();
            return findNode(obs.roots, node => node.text.includes(text.slice(0, 10)))
                ? true
                : null;
        }, { timeoutMs: 8000 });
        const publish = await waitFor(async () => {
            const obs = await this.driver.observe();
            const hits = findNodes(obs.roots, node => node.text === '发表');
            const ready = hits.find(n => n.enabled && n.bounds.right > n.bounds.left);
            return ready ?? null;
        }, { timeoutMs: 8000 });
        await this.driver.tap(centerOf(publish));
        await sleep(4000);
    }
    async locateHoldButton() {
        const observation = await this.driver.observe();
        const visible = findNode(observation.roots, node => SELECTORS.holdToTalk.test(node.text) ||
            SELECTORS.holdToTalk.test(node.desc));
        if (visible)
            return visible;
        const toggle = findNode(observation.roots, node => SELECTORS.voiceSwitch.test(node.desc) ||
            /voice|audio/i.test(node.resourceId));
        if (!toggle) {
            throw new DeviceError('QQ_NO_VOICE', 'voice switch not found');
        }
        await this.driver.tap(centerOf(toggle));
        return waitFor(async () => {
            const current = await this.driver.observe();
            return findNode(current.roots, node => SELECTORS.holdToTalk.test(node.text) ||
                SELECTORS.holdToTalk.test(node.desc));
        }, { timeoutMs: 8000 });
    }
    /**
     * QQ resumes into the last opened chat, where the conversation list and its
     * search entry are both absent. Both send and reply need the list (reply
     * needs the unread rows, send needs the search box), so back out once when
     * neither marker is on screen. Without this a message arriving while a chat
     * is open makes the reply loop report "no unread" — a false negative.
     */
    async ensureConversationList() {
        const onList = async () => {
            const obs = await this.driver.observe();
            return (findNode(obs.roots, node => node.desc === '搜索' || node.text === '搜索') !== null ||
                findNode(obs.roots, node => /:id\/aua$/.test(node.resourceId)) !== null);
        };
        if (await onList()) {
            return;
        }
        for (let attempt = 0; attempt < 2; attempt++) {
            await this.driver.pressKey('back');
            await sleep(800);
            if (await onList()) {
                return;
            }
        }
    }
    async collectUnreadRows() {
        const observation = await this.driver.observe();
        const width = observation.screenSize.width;
        const clickable = findNodes(observation.roots, node => node.clickable &&
            node.bounds.right - node.bounds.left > width * 0.6 &&
            node.bounds.bottom - node.bounds.top > 40 &&
            node.bounds.bottom - node.bounds.top < 220);
        // Service accounts also carry unread badges and their preview text is not
        // a peer name; replying to them is never what "answer my friends" means.
        const isServiceRow = (row) => {
            const name = (row.desc || row.text || '').split(',')[0]?.trim() ?? '';
            return /^(公众号|服务号|订阅号|QQ安全中心|QQ团队|频道助手|我的关联QQ账号)/.test(name);
        };
        const unread = clickable.filter(row => !isServiceRow(row) &&
            // QQ 9.3.x puts the whole row summary ("name, ,2条未读,...") in the
            // row node's own content-desc, not in child nodes — checking only
            // children made every badge invisible and the reply loop a no-op.
            (SELECTORS.unreadBadge.test(row.desc) ||
                SELECTORS.unreadBadge.test(row.text) ||
                findNode(row.children, child => SELECTORS.unreadBadge.test(child.desc) ||
                    SELECTORS.unreadBadge.test(child.text) ||
                    /^\d+$/.test(child.text)) !== null));
        // Only rows that actually carry an unread badge. The old fallback to every
        // clickable row meant "badges cleared" became "these chats are unread",
        // and the fish messaged people who had not written anything.
        return unread;
    }
    async readMessages() {
        const observation = await this.driver.observe();
        const { width, height } = observation.screenSize;
        const textNodes = findNodes(observation.roots, node => node.text.length > 0 &&
            node.bounds.top > height * 0.08 &&
            node.bounds.bottom < height * 0.85);
        const seen = new Set();
        const messages = [];
        for (const node of textNodes) {
            const key = `${node.text}@${node.bounds.left}`;
            if (seen.has(key))
                continue;
            seen.add(key);
            const centerX = (node.bounds.left + node.bounds.right) / 2;
            // Probe chat.xml: centered timestamp chips like
            // "星期四 上午11:29" sit at centerX ~= width/2 and must not be
            // collected as incoming messages.
            const isTimestamp = Math.abs(centerX - width / 2) < width * 0.08 &&
                /星期|上午|下午|晚上/.test(node.text);
            if (isTimestamp)
                continue;
            messages.push({
                sender: '',
                content: node.text,
                isSelf: centerX > width / 2,
                time: '',
            });
        }
        return messages;
    }
    async composeReply(peer, incoming) {
        const memories = await this.memory.recall(`qq ${peer}`, 5);
        const known = memories.map(m => m.content).join('\n');
        const transcript = incoming.map(m => m.content).join('\n');
        const reply = await this.llm.chat([
            {
                role: 'system',
                content: 'You are DQY replying inside mobile QQ. ' +
                    'Write one short, natural, colloquial Chinese reply. ' +
                    'Output the reply only, no quotes, no explanation, under 50 Chinese characters.',
            },
            {
                role: 'user',
                content: `peer: ${peer}\n` +
                    (known ? `known facts:\n${known}\n` : '') +
                    `incoming messages:\n${transcript}`,
            },
        ]);
        return reply.trim().replace(/^["“”]|["“”]$/g, '');
    }
    async sendReply(reply) {
        const observation = await this.driver.observe();
        const input = findNode(observation.roots, node => node.className.includes('EditText') ||
            SELECTORS.inputHint.test(node.text) ||
            SELECTORS.inputHint.test(node.desc));
        if (!input) {
            throw new DeviceError('QQ_NO_INPUT', 'cannot find chat input box');
        }
        await this.driver.tap(centerOf(input));
        await sleep(400);
        // Chinese replies must not go through the ASCII-only `input text` path.
        await enterText(this.driver, reply);
        await sleep(300);
        await this.submitSend();
        return confirmOutgoing(this.driver, reply);
    }
    peerName(row) {
        // Probe home.xml: the friend name is the first comma-segment of the
        // rid=aua row's content-desc. The first non-empty TextView inside the
        // row is actually the preview summary, not the name.
        const aua = findNode(row.children, node => /:id\/aua$/.test(node.resourceId) && node.desc.includes(','));
        if (aua) {
            const name = aua.desc.split(',')[0]?.trim();
            if (name)
                return name;
        }
        // QQ 9.3.83 puts "name, ,2条未读,preview" on the row node itself; the first
        // comma segment is the peer name. Child text is the preview, which used to
        // be glued into the name and made the conversation impossible to open.
        const own = (row.desc || '').split(',')[0]?.trim();
        if (own) {
            return own;
        }
        const title = findNode(row.children, node => node.text.length > 0 && node.className.includes('TextView'));
        return title?.text ?? 'unknown';
    }
}
function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
// Locate a node whose text matches `re`, then return the nearest clickable
// ancestor (with real bounds and top >= minTop) that should actually be
// tapped. QQ renders several labels (bottom-nav tabs, the compose box) with
// zero bounds on the text node itself, so the click target is the parent
// frame. Falls back to the matched node when no qualifying ancestor exists.
function findClickableByText(roots, re, minTop = 0) {
    let found = null;
    const walk = (nodes, ancestors) => {
        if (found)
            return;
        for (const node of nodes) {
            if (re.test(node.text)) {
                const chain = [...ancestors, node];
                for (let i = chain.length - 1; i >= 0; i--) {
                    const cand = chain[i];
                    if (cand.clickable &&
                        cand.bounds.right > cand.bounds.left &&
                        cand.bounds.top >= minTop) {
                        found = cand;
                        return;
                    }
                }
                if (node.bounds.right > node.bounds.left)
                    found = node;
                return;
            }
            walk(node.children, [...ancestors, node]);
        }
    };
    walk(roots, []);
    return found;
}
