import { DeviceError } from '../../domain/errors.js';
import { failResult, okResult } from '../../domain/adapter-types.js';
import { centerOf, findNode, findNodes, sleep, waitFor, waitForApp, withRetry, } from '../support/wait-for.js';
export const DOUYIN_PACKAGE = 'com.ss.android.ugc.aweme';
const SELECTORS = {
    commentEntry: /评论|comment/i,
    shareEntry: /分享|转发|share/i,
    send: /^发送$|^回复$|^发布$|^提交$/,
    // Real-device placeholders observed: "发条评论，说说你的感受",
    // "有爱评论，说点儿好听的", "有什么想法，展开说说".
    inputHint: /说点|说说|有爱评论|发条评论|精彩评论|友善评论|输入|有什么想法|展开说说/,
    liveEntry: /直播|live/i,
    // The bottom-nav "我" label itself is clickable=false; its parent frame is.
    // Match by text or by the "我，按钮" content-desc without requiring clickable.
    mineTab: /^我$|^我的$|个人中心|^我，按钮/,
    petEntry: /抖音宠物|宠物|pet/i,
    feedAction: /喂食|投喂|喂养/i,
    searchEntry: /搜索|search/i,
    // Real-device (Douyin 41.0) heart button: resourceId ends with /:id/gwp,
    // content-desc "未点赞，喜欢17.2万，按钮" -> flips to "已点赞..." after tap.
    likeButton: /:id\/gwp$/,
    likeDesc: /喜欢.*按钮|点赞|未点赞|已点赞/,
    likedDesc: /已点赞/,
};
export class DouyinService {
    driver;
    memory;
    id = 'douyin';
    displayName = '抖音';
    packageName = DOUYIN_PACKAGE;
    capabilities = new Set([
        'feed',
        'comment',
        'social',
        'live',
        'pet',
    ]);
    todos = [
        {
            capability: 'message',
            feature: 'send DM text/image',
            note: 'Douyin direct message sending not implemented yet',
        },
        {
            capability: 'signin',
            feature: 'daily sign-in',
            note: 'Douyin daily check-in not implemented yet',
        },
    ];
    capability = 'feed';
    constructor(driver, memory) {
        this.driver = driver;
        this.memory = memory;
    }
    async initialize() {
        // No bootstrap required for Douyin.
    }
    async browseFeed(arg) {
        const legacy = arg;
        const adapter = arg;
        const videos = legacy?.videos ?? adapter?.count ?? 10;
        const watchMs = legacy?.watchMs ?? adapter?.watchMs ?? 6000;
        const likeProbability = legacy?.likeProbability ?? 0.2;
        const keywords = legacy?.likeKeywords ?? adapter?.likeKeywords ?? [];
        const isAdapterCall = arg !== undefined && 'count' in arg;
        await this.driver.connect();
        await this.driver.openApp(DOUYIN_PACKAGE);
        await waitForApp(this.driver, DOUYIN_PACKAGE, {
            timeoutMs: 15000,
        });
        await sleep(3000);
        const size = await this.driver.screenSize();
        let liked = 0;
        for (let i = 0; i < videos; i++) {
            await sleep(watchMs);
            if (await this.shouldLike(keywords, likeProbability)) {
                if (await this.likeCurrent())
                    liked++;
            }
            await this.nextVideo(size);
            await sleep(1200);
        }
        const session = {
            app: DOUYIN_PACKAGE,
            watched: videos,
            liked,
            finishedAt: new Date().toISOString(),
        };
        await this.memory.remember({
            kind: 'event',
            content: `Douyin feed session: watched ${videos}, liked ${liked}`,
            tags: ['douyin', 'feed'],
        });
        if (isAdapterCall) {
            return okResult(`watched ${videos} videos, liked ${liked}`, { watched: videos, liked });
        }
        return session;
    }
    async likeCurrentVideo() {
        const liked = await this.likeCurrent();
        await this.logEvent('like', liked ? 'tapped like button' : 'like button not found');
        return {
            action: 'like',
            detail: liked ? 'tapped like button' : 'like button not found',
            sent: liked,
        };
    }
    async comment(arg) {
        const input = typeof arg === 'string' ? { text: arg } : arg;
        if (!input.text) {
            if (typeof arg === 'string') {
                throw new DeviceError('DOUYIN_BAD_COMMENT', 'comment text is required');
            }
            return failResult('comment text is required');
        }
        try {
            await this.openCommentPanel();
            await this.typeTextIntoCurrentInput(input.text);
            await this.tapSend();
            await sleep(600);
            await this.driver.pressKey('back');
            await this.logEvent('comment', input.text);
            if (typeof arg === 'string') {
                return { action: 'comment', detail: input.text, sent: true };
            }
            return okResult(`commented: ${input.text}`, { sent: true });
        }
        catch (err) {
            if (typeof arg === 'string')
                throw err;
            return failResult(`comment failed: ${err.message}`);
        }
    }
    async browseComments(limit = 20) {
        const items = [];
        try {
            await this.openCommentPanel();
            await sleep(1500);
            // Wait until the comment list actually has rows.
            const observation = await waitFor(async () => {
                const obs = await this.driver.observe();
                const lines = findNodes(obs.roots, n => n.text.trim().length > 0);
                return lines.length >= 4 ? obs : null;
            }, { timeoutMs: 8000 });
            const chrome = /^(发送|回复|发布|提交|我来.*|说点.*|.*条评论|.*条回复|^评论$|友善评论|精彩评论|^\d+)$/;
            const lines = findNodes(observation.roots, n => {
                const t = n.text.trim();
                return t.length > 0 && !chrome.test(t);
            }).map(n => n.text.trim());
            // Heuristic: a short author line is followed by its content line.
            // Likely needs real-device tuning per Douyin version.
            const seen = new Set();
            for (let i = 0; i < lines.length; i++) {
                const line = lines[i];
                const next = lines[i + 1];
                const looksLikeAuthor = next !== undefined &&
                    line.length <= 16 &&
                    !/[。！？，,.!?]$/.test(line);
                if (looksLikeAuthor) {
                    const key = `${line}::${next}`;
                    if (!seen.has(key)) {
                        seen.add(key);
                        items.push({ author: line, text: next });
                    }
                    i++;
                }
                else {
                    const key = `::${line}`;
                    if (!seen.has(key)) {
                        seen.add(key);
                        items.push({ author: '', text: line });
                    }
                }
                if (items.length >= limit)
                    break;
            }
        }
        catch {
            // Panel never opened or timed out: report whatever we collected.
        }
        return { items };
    }
    async replyComment(input) {
        if (!input.text) {
            return failResult('reply text is required');
        }
        try {
            await this.openCommentPanel();
            await sleep(1200);
            // Tap the target comment row, or the first row in the list.
            const row = await waitFor(async () => {
                const obs = await this.driver.observe();
                if (input.target) {
                    const hit = findNode(obs.roots, n => n.text.includes(input.target) ||
                        n.desc.includes(input.target));
                    if (hit)
                        return hit;
                }
                const rows = findNodes(obs.roots, n => n.clickable &&
                    n.text.trim().length > 0 &&
                    !SELECTORS.inputHint.test(n.text));
                return rows[0] ?? null;
            }, { timeoutMs: 8000 });
            await this.driver.tap(centerOf(row));
            await sleep(800);
            // Bring up the reply affordance.
            const replyBtn = await waitFor(async () => {
                const obs = await this.driver.observe();
                return (findNode(obs.roots, n => /^回复$|回复/.test(n.text) || /^回复$|回复/.test(n.desc)) ?? null);
            }, { timeoutMs: 5000 });
            await this.driver.tap(centerOf(replyBtn));
            await sleep(800);
            await this.typeTextIntoCurrentInput(input.text);
            await this.tapSend();
            await sleep(600);
            await this.driver.pressKey('back');
            await this.driver.pressKey('back');
            await this.logEvent('reply', input.text);
            return okResult(`replied: ${input.text}`, { sent: true });
        }
        catch (err) {
            return failResult(`reply failed: ${err.message}`);
        }
    }
    async forward(target) {
        if (!target) {
            throw new DeviceError('DOUYIN_BAD_TARGET', 'forward target is required');
        }
        const findShareEntry = async () => {
            const obs = await this.driver.observe();
            return findNode(obs.roots, node => SELECTORS.shareEntry.test(node.desc) ||
                SELECTORS.shareEntry.test(node.resourceId));
        };
        const findTarget = async () => {
            const panel = await this.driver.observe();
            return findNode(panel.roots, node => node.text.includes(target) || node.desc.includes(target));
        };
        let share = await findShareEntry();
        if (!share) {
            // A live room (or any non-video page) has no video share button; leave
            // it and look again before giving up, instead of failing the demo.
            await this.driver.pressKey('back');
            await sleep(1200);
            share = await findShareEntry();
        }
        if (!share) {
            throw new DeviceError('DOUYIN_NO_SHARE', 'share button not found (a live room or a non-video page is open)');
        }
        await this.driver.tap(centerOf(share));
        let targetNode = await waitFor(findTarget, { timeoutMs: 7000 }).then(node => node, () => null);
        if (!targetNode) {
            // The panel sometimes does not open (stale video, previous overlay).
            // Close whatever is on screen and retry once from the share button.
            await this.driver.pressKey('back');
            await sleep(800);
            share = await findShareEntry();
            if (!share) {
                throw new DeviceError('DOUYIN_NO_SHARE', 'share button not found on retry');
            }
            await this.driver.tap(centerOf(share));
            targetNode = await waitFor(findTarget, { timeoutMs: 8000 });
        }
        await this.driver.tap(centerOf(targetNode));
        // Douyin only selects the target on the first tap; a compose sheet with a
        // 发送 button appears and the share is not delivered until it is pressed.
        const confirm = await waitFor(async () => {
            const panel = await this.driver.observe();
            return findNode(panel.roots, node => node.text === '发送' || node.desc === '发送');
        }, { timeoutMs: 4000 }).then(node => node, () => null);
        if (confirm) {
            await this.driver.tap(centerOf(confirm));
        }
        // A share only counts when the panel actually closed and no error prompt
        // appeared. The old code returned sent:true straight after the tap.
        let failure = '';
        const confirmed = await waitFor(async () => {
            const after = await this.driver.observe();
            const bad = findNode(after.roots, node => /发送失败|分享失败|网络异常|操作频繁/.test(`${node.text} ${node.desc}`));
            if (bad) {
                failure = bad.text || bad.desc;
                return true;
            }
            const panel = findNode(after.roots, node => /分享链接|建群分享|转发到日常/.test(`${node.text} ${node.desc}`));
            return panel ? null : true;
        }, { timeoutMs: 8000 }).then(() => true, () => false);
        if (failure) {
            await this.logEvent('forward', `${target} -> failed: ${failure}`);
            return {
                action: 'forward',
                detail: `share failed: ${failure}`,
                sent: false,
            };
        }
        await this.logEvent('forward', target);
        return confirmed
            ? { action: 'forward', detail: `shared with ${target}`, sent: true }
            : {
                action: 'forward',
                detail: `share panel did not close for ${target}`,
                sent: false,
            };
    }
    async mention(arg, text) {
        const input = typeof arg === 'string'
            ? { friend: arg, text: text ?? '' }
            : arg;
        if (!input.friend) {
            if (typeof arg === 'string') {
                throw new DeviceError('DOUYIN_BAD_FRIEND', 'friend name is required for mention');
            }
            return failResult('mention friend is required');
        }
        try {
            await this.openCommentPanel();
            const inputNode = await this.waitInput();
            await this.driver.tap(centerOf(inputNode));
            await sleep(600);
            await this.driver.inputText('@');
            const friendNode = await waitFor(async () => {
                const panel = await this.driver.observe();
                return findNode(panel.roots, node => node.text.includes(input.friend) ||
                    node.desc.includes(input.friend));
            }, { timeoutMs: 10000 });
            await this.driver.tap(centerOf(friendNode));
            await sleep(600);
            if (input.text) {
                await this.driver.inputText(` ${input.text}`);
                await sleep(300);
            }
            await this.tapSend();
            await sleep(500);
            await this.driver.pressKey('back');
            const detail = `${input.friend}${input.text ? `: ${input.text}` : ''}`;
            await this.logEvent('mention', detail);
            if (typeof arg === 'string') {
                return { action: 'mention', detail, sent: true };
            }
            return okResult(`mentioned: ${detail}`, { sent: true });
        }
        catch (err) {
            if (typeof arg === 'string')
                throw err;
            return failResult(`mention failed: ${err.message}`);
        }
    }
    // ------------------------------------------------------------------
    // Live capability
    // ------------------------------------------------------------------
    async watchLive(input) {
        const durationMs = input.durationMs ?? 8000;
        try {
            await this.driver.openApp(DOUYIN_PACKAGE);
            await waitForApp(this.driver, DOUYIN_PACKAGE, {
                timeoutMs: 15000,
            });
            await sleep(2500);
            // Enter the live feed: top '直播' tab or any live card.
            const liveEntry = await waitFor(async () => {
                const obs = await this.driver.observe();
                return (findNode(obs.roots, n => n.clickable &&
                    (SELECTORS.liveEntry.test(n.text) ||
                        SELECTORS.liveEntry.test(n.desc))) ?? null);
            }, { timeoutMs: 8000 });
            await this.driver.tap(centerOf(liveEntry));
            await sleep(2500);
            // Optionally jump to a specific anchor.
            if (input.anchor) {
                try {
                    const anchorNode = await waitFor(async () => {
                        const obs = await this.driver.observe();
                        return (findNode(obs.roots, n => n.text.includes(input.anchor) ||
                            n.desc.includes(input.anchor)) ?? null);
                    }, { timeoutMs: 4000 });
                    await this.driver.tap(centerOf(anchorNode));
                    await sleep(2000);
                }
                catch {
                    // Anchor not matched: stay in the live feed.
                }
            }
            // Dwell, sending one heart midway.
            await sleep(Math.floor(durationMs / 2));
            try {
                await this.likeCurrent();
            }
            catch {
                // Heart is best-effort inside a live room.
            }
            await sleep(Math.ceil(durationMs / 2));
            await this.logEvent('live', `watched ${durationMs}ms`);
            return okResult(`watched live for ${durationMs}ms`, {
                durationMs,
                liked: true,
            });
        }
        catch (err) {
            return failResult(`watchLive failed: ${err.message}`);
        }
    }
    // ------------------------------------------------------------------
    // Pet capability (entry heuristics; needs real-device confirmation)
    // ------------------------------------------------------------------
    async feedPet() {
        try {
            return await withRetry(async () => this.runFeedPet(), { attempts: 2, delayMs: 1000 });
        }
        catch (err) {
            return failResult(`feedPet failed: ${err.message} ` +
                '(entry heuristic needs real-device tuning)');
        }
    }
    async runFeedPet() {
        await this.driver.openApp(DOUYIN_PACKAGE);
        await waitForApp(this.driver, DOUYIN_PACKAGE, {
            timeoutMs: 15000,
        });
        await sleep(2000);
        // Route A: '我' tab -> pet entry. Fallback: search '抖音宠物'.
        let entered = false;
        try {
            const mine = await waitFor(async () => {
                const obs = await this.driver.observe();
                // The "我" label node itself is clickable=false; its parent frame is,
                // so drop the clickable requirement and match text or desc.
                return (findNode(obs.roots, n => SELECTORS.mineTab.test(n.text.trim()) ||
                    SELECTORS.mineTab.test(n.desc)) ?? null);
            }, { timeoutMs: 4000 });
            await this.driver.tap(centerOf(mine));
            await sleep(1500);
            const petEntry = await waitFor(async () => {
                const obs = await this.driver.observe();
                return (findNode(obs.roots, n => SELECTORS.petEntry.test(n.text) ||
                    SELECTORS.petEntry.test(n.desc)) ?? null);
            }, { timeoutMs: 4000 });
            await this.driver.tap(centerOf(petEntry));
            entered = true;
        }
        catch {
            entered = false;
        }
        // TODO(real-device): On Douyin 41.0 the "我" page exposes no 宠物/pet/
        // 喂食 entry (only 我的订单/钱包/客服/小程序/全部功能), so this search
        // fallback path is taken. The search-results page and how to reach the
        // pet farm from it are NOT verified on a real device yet.
        if (!entered) {
            const search = await waitFor(async () => {
                const obs = await this.driver.observe();
                return (findNode(obs.roots, n => SELECTORS.searchEntry.test(n.text) ||
                    SELECTORS.searchEntry.test(n.desc)) ?? null);
            }, { timeoutMs: 5000 });
            await this.driver.tap(centerOf(search));
            await sleep(1000);
            await this.typeTextIntoCurrentInput('抖音宠物');
            await this.driver.pressKey('enter');
            await sleep(2500);
            const card = await waitFor(async () => {
                const obs = await this.driver.observe();
                const rows = findNodes(obs.roots, n => n.clickable && n.text.trim().length > 0);
                return rows[0] ?? null;
            }, { timeoutMs: 5000 });
            await this.driver.tap(centerOf(card));
            await sleep(2000);
        }
        const feedBtn = await waitFor(async () => {
            const obs = await this.driver.observe();
            return (findNode(obs.roots, n => SELECTORS.feedAction.test(n.text) ||
                SELECTORS.feedAction.test(n.desc)) ?? null);
        }, { timeoutMs: 8000 });
        await this.driver.tap(centerOf(feedBtn));
        await sleep(1500);
        const feedback = await waitFor(async () => {
            const obs = await this.driver.observe();
            return (findNode(obs.roots, n => /成功|已喂|投喂|喂食|饱|收获/.test(n.text) ||
                /成功|已喂|投喂|喂食|饱|收获/.test(n.desc)) ?? null);
        }, { timeoutMs: 4000 }).catch(() => null);
        await this.logEvent('pet', 'fed douyin pet');
        return okResult(`fed douyin pet${feedback ? `: ${feedback.text}` : ''}`, { confirmed: feedback !== null });
    }
    // ------------------------------------------------------------------
    // Internals
    // ------------------------------------------------------------------
    async shouldLike(keywords, probability) {
        if (keywords.length > 0) {
            const observation = await this.driver.observe();
            const hit = findNode(observation.roots, node => keywords.some(keyword => node.text.includes(keyword) ||
                node.desc.includes(keyword)));
            if (hit)
                return true;
        }
        return Math.random() < probability;
    }
    async likeCurrent() {
        // Tap the on-screen like (heart) button directly. Double-tapping screen
        // center was too slow on this EMUI device and mis-fired the AI "接着问"
        // panel instead of registering a like.
        try {
            const node = await waitFor(async () => {
                const obs = await this.driver.observe();
                return (findNode(obs.roots, n => SELECTORS.likeButton.test(n.resourceId) ||
                    (SELECTORS.likeDesc.test(n.desc) && n.clickable)) ?? null);
            }, { timeoutMs: 4000 });
            if (SELECTORS.likedDesc.test(node.desc)) {
                return false; // already liked; do not unlike
            }
            await this.driver.tap(centerOf(node));
            await sleep(600);
            return true;
        }
        catch {
            return false;
        }
    }
    async nextVideo(size) {
        const x = Math.round(size.width / 2);
        await this.driver.swipe({ x, y: Math.round(size.height * 0.78) }, { x, y: Math.round(size.height * 0.22) }, 300);
    }
    async openCommentPanel() {
        const observation = await this.driver.observe();
        const entry = findNode(observation.roots, node => SELECTORS.commentEntry.test(node.desc) ||
            SELECTORS.commentEntry.test(node.resourceId));
        if (!entry) {
            throw new DeviceError('DOUYIN_NO_COMMENT', 'comment button not found');
        }
        await this.driver.tap(centerOf(entry));
        await sleep(1200);
    }
    async waitInput() {
        return waitFor(async () => {
            const observation = await this.driver.observe();
            return findNode(observation.roots, node => node.className.includes('EditText') ||
                SELECTORS.inputHint.test(node.text) ||
                SELECTORS.inputHint.test(node.desc));
        }, { timeoutMs: 10000 });
    }
    async typeTextIntoCurrentInput(text) {
        const input = await this.waitInput();
        await this.driver.tap(centerOf(input));
        await sleep(600);
        await this.driver.inputText(text);
        await sleep(400);
    }
    async tapSend() {
        const observation = await this.driver.observe();
        const send = findNode(observation.roots, node => SELECTORS.send.test(node.text) ||
            SELECTORS.send.test(node.desc));
        if (!send) {
            throw new DeviceError('DOUYIN_NO_SEND', 'send button not found');
        }
        await this.driver.tap(centerOf(send));
    }
    async logEvent(action, detail) {
        await this.memory.remember({
            kind: 'event',
            content: `Douyin ${action}: ${detail}`,
            tags: ['douyin', action],
        });
    }
}
