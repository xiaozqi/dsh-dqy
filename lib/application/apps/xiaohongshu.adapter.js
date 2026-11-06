import { failResult, okResult } from '../../domain/adapter-types.js';
import { openAndWait, pushMedia, tapByMatcher, tapSend, typeIntoInput, waitAndTapPeer, } from '../adapters/base-adapter.js';
import { centerOf, findNode, findNodes, sleep, waitFor, withRetry, } from '../support/wait-for.js';
export const XHS_PACKAGE = 'com.xingin.xhs';
// Heuristic selectors only. Xiaohongshu is NOT installed on the current
// 1080x2208 EMUI device yet, so every selector below is a best-effort guess
// and must be tuned against a real UI dump after the app is installed.
const SELECT = {
    commentEntry: [
        { desc: /评论/ },
        { text: /评论/ },
        { resourceId: /comment/i },
    ],
    likeButton: [
        { desc: /^赞$/ },
        { text: /^赞$/ },
        { resourceId: /like|praise|favorite|thumb/i },
    ],
    messageTab: [
        { text: /^消息$/ },
        { desc: /消息/ },
        { resourceId: /message|msg|chat/i },
    ],
    replyEntry: [
        { text: /^回复$/ },
        { desc: /回复/ },
    ],
    searchEntry: [
        { desc: /搜索/ },
        { text: /搜索/ },
    ],
    plusButton: [
        { desc: /更多|加号/ },
        { text: /\+/ },
        { resourceId: /plus|more|add/i },
    ],
    imageEntry: [
        { text: /^图片$/ },
        { desc: /图片/ },
    ],
    sendText: [/^发送$/, /^回复$/, /^发布$/],
};
export class XhsAdapter {
    driver;
    memory;
    id = 'xiaohongshu';
    displayName = '小红书';
    packageName = XHS_PACKAGE;
    capabilities = new Set([
        'feed',
        'comment',
        'social',
        'message',
    ]);
    todos = [
        {
            capability: 'live',
            feature: 'live stream',
            note: 'not implemented: live entry and player page need a real-device UI dump; pending install and on-device verification',
        },
        {
            capability: 'social',
            feature: 'favorite / collect note state tracking',
            note: 'not implemented: collect entry and state detection need real-device selector tuning; pending install and on-device verification',
        },
        {
            capability: 'signin',
            feature: 'daily check-in',
            note: 'not implemented: check-in entry path unconfirmed; pending install and on-device verification',
        },
        {
            capability: 'comment',
            feature: 'like a comment',
            note: 'not implemented: per-comment like button needs a real-device UI dump; pending install and on-device verification',
        },
    ];
    constructor(driver, memory) {
        this.driver = driver;
        this.memory = memory;
    }
    async initialize() { }
    async browseFeed(input = {}) {
        const count = input.count ?? 10;
        const watchMs = input.watchMs ?? 5000;
        const keywords = input.likeKeywords ?? [];
        try {
            await this.openXhs();
            let liked = 0;
            for (let i = 0; i < count; i++) {
                await sleep(watchMs);
                if (keywords.length > 0 && (await this.containsKeyword(keywords))) {
                    await this.likeCurrent();
                    liked++;
                }
                await this.swipeUp();
                await sleep(1000);
            }
            await this.remember('feed', `browsed ${count} notes, liked ${liked}`);
            return okResult(`feed done: watched ${count}, liked ${liked}`, {
                watched: count,
                liked,
            });
        }
        catch (err) {
            return failResult(`feed failed: ${this.errText(err)}`);
        }
    }
    async comment(input) {
        try {
            await this.openXhs();
            if (input.target) {
                try {
                    await tapByMatcher(this.driver, { text: input.target }, { timeoutMs: 5000 });
                }
                catch {
                    // target note not on screen; comment on the current one
                }
            }
            await this.tapAny(SELECT.commentEntry, 8000);
            await sleep(1200);
            await typeIntoInput(this.driver, input.text, { className: /EditText/i }, { timeoutMs: 8000 });
            await tapSend(this.driver, { timeoutMs: 8000 });
            await this.remember('comment', input.text);
            return okResult('comment sent', { text: input.text });
        }
        catch (err) {
            return failResult(`comment failed: ${this.errText(err)}`);
        }
    }
    async replyComment(input) {
        try {
            await this.openXhs();
            try {
                await this.tapAny(SELECT.commentEntry, 3000);
                await sleep(1000);
            }
            catch {
                // comment panel assumed already open
            }
            const target = input.target;
            if (target) {
                const row = await waitFor(async () => {
                    const obs = await this.driver.observe();
                    return findNode(obs.roots, n => n.text.includes(target));
                }, { timeoutMs: 8000 });
                await this.driver.tap(centerOf(row));
            }
            else {
                const row = await waitFor(async () => {
                    const obs = await this.driver.observe();
                    return findNode(obs.roots, n => n.text.length > 0 && n.clickable);
                }, { timeoutMs: 6000 });
                await this.driver.tap(centerOf(row));
            }
            await sleep(800);
            await this.tapAny(SELECT.replyEntry, 6000);
            await sleep(600);
            await typeIntoInput(this.driver, input.text, { className: /EditText/i }, { timeoutMs: 8000 });
            await tapSend(this.driver, { timeoutMs: 8000 });
            await this.remember('reply', input.text);
            return okResult('reply sent', { text: input.text });
        }
        catch (err) {
            return failResult(`reply failed: ${this.errText(err)}`);
        }
    }
    async browseComments(limit = 20) {
        try {
            const obs = await this.driver.observe();
            const rows = findNodes(obs.roots, n => n.text.length > 0 &&
                n.className.includes('TextView') &&
                !SELECT.sendText.some(re => re.test(n.text)));
            return { items: rows.slice(0, limit).map(n => ({ author: '', text: n.text })) };
        }
        catch {
            return { items: [] };
        }
    }
    async mention(input) {
        try {
            await this.openXhs();
            await this.tapAny(SELECT.commentEntry, 8000);
            await sleep(1200);
            await typeIntoInput(this.driver, '@', undefined, { timeoutMs: 8000 });
            const friend = input.friend;
            const candidate = await waitFor(async () => {
                const obs = await this.driver.observe();
                return findNode(obs.roots, n => n.text.includes(friend) || n.desc.includes(friend));
            }, { timeoutMs: 10000 });
            await this.driver.tap(centerOf(candidate));
            await sleep(600);
            if (input.text) {
                await this.driver.inputText(` ${input.text}`);
                await sleep(300);
            }
            await tapSend(this.driver, { timeoutMs: 8000 });
            await this.remember('mention', `${friend}: ${input.text ?? ''}`);
            return okResult('mention sent', { friend, text: input.text ?? '' });
        }
        catch (err) {
            return failResult(`mention failed: ${this.errText(err)}`);
        }
    }
    async sendMessage(input) {
        try {
            await this.openXhs();
            await this.tapAny(SELECT.messageTab, 8000);
            await sleep(1500);
            await this.tapAny(SELECT.searchEntry, 6000);
            await typeIntoInput(this.driver, input.peer, undefined, { timeoutMs: 6000 });
            await waitAndTapPeer(this.driver, input.peer, { timeoutMs: 10000 });
            await typeIntoInput(this.driver, input.text, undefined, { timeoutMs: 8000 });
            await tapSend(this.driver, { timeoutMs: 8000 });
            await this.remember('message', `${input.peer}: ${input.text}`);
            return okResult(`message sent to ${input.peer}`, { peer: input.peer });
        }
        catch (err) {
            return failResult(`sendMessage failed: ${this.errText(err)}`);
        }
    }
    async sendImage(input) {
        try {
            await this.openXhs();
            await this.tapAny(SELECT.messageTab, 8000);
            await sleep(1500);
            await this.tapAny(SELECT.searchEntry, 6000);
            await typeIntoInput(this.driver, input.peer, undefined, { timeoutMs: 6000 });
            await waitAndTapPeer(this.driver, input.peer, { timeoutMs: 10000 });
            await pushMedia(this.driver, input.localImagePath);
            await this.tapAny(SELECT.plusButton, 6000);
            await sleep(800);
            await this.tapAny(SELECT.imageEntry, 6000);
            await sleep(1200);
            const photo = await waitFor(async () => {
                const obs = await this.driver.observe();
                return findNode(obs.roots, n => n.clickable && n.className.includes('Image'));
            }, { timeoutMs: 8000 });
            await this.driver.tap(centerOf(photo));
            await sleep(800);
            if (input.caption) {
                await typeIntoInput(this.driver, input.caption, undefined, { timeoutMs: 5000 });
            }
            await tapSend(this.driver, { timeoutMs: 8000 });
            await this.remember('image', `${input.peer}: ${input.localImagePath}`);
            return okResult(`image sent to ${input.peer}`, { peer: input.peer });
        }
        catch (err) {
            return failResult(`sendImage failed: ${this.errText(err)}`);
        }
    }
    async readConversation(peer, limit = 20) {
        try {
            await this.openXhs();
            await this.tapAny(SELECT.messageTab, 8000);
            await sleep(1500);
            if (peer) {
                await this.tapAny(SELECT.searchEntry, 6000);
                await typeIntoInput(this.driver, peer, undefined, { timeoutMs: 6000 });
                await waitAndTapPeer(this.driver, peer, { timeoutMs: 10000 });
            }
            const obs = await this.driver.observe();
            const bubbles = findNodes(obs.roots, n => n.text.length > 0 && n.className.includes('TextView'));
            return {
                peer: peer ?? '',
                incoming: bubbles.map(n => n.text).slice(0, limit),
            };
        }
        catch {
            return { peer: peer ?? '', incoming: [] };
        }
    }
    async openXhs() {
        await withRetry(() => openAndWait(this.driver, XHS_PACKAGE, { timeoutMs: 20000 }), { attempts: 2, delayMs: 1500 });
    }
    async tapAny(candidates, timeoutMs = 8000) {
        let lastError = new Error('no selector candidate matched');
        for (const matcher of candidates) {
            try {
                return await tapByMatcher(this.driver, matcher, {
                    timeoutMs,
                    intervalMs: 800,
                });
            }
            catch (err) {
                lastError = err;
            }
        }
        throw lastError;
    }
    async containsKeyword(keywords) {
        const obs = await this.driver.observe();
        return (findNode(obs.roots, n => keywords.some(k => n.text.includes(k) || n.desc.includes(k))) !== null);
    }
    async likeCurrent() {
        try {
            await this.tapAny(SELECT.likeButton, 3000);
        }
        catch {
            const size = await this.driver.screenSize();
            const mid = {
                x: Math.round(size.width / 2),
                y: Math.round(size.height * 0.45),
            };
            await this.driver.tap(mid);
            await sleep(120);
            await this.driver.tap(mid);
            await sleep(500);
        }
    }
    async swipeUp() {
        const size = await this.driver.screenSize();
        const x = Math.round(size.width / 2);
        await this.driver.swipe({ x, y: Math.round(size.height * 0.78) }, { x, y: Math.round(size.height * 0.25) }, 400);
    }
    async remember(action, detail) {
        await this.memory.remember({
            kind: 'event',
            content: `Xiaohongshu ${action}: ${detail}`,
            tags: ['xiaohongshu', action],
        });
    }
    errText(err) {
        return err instanceof Error ? err.message : String(err);
    }
}
