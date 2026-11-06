import { failResult, okResult } from '../../domain/adapter-types.js';
import { openAndWait, tapByMatcher, typeIntoInput, } from '../adapters/base-adapter.js';
import { findNode, sleep, waitFor, withRetry, } from '../support/wait-for.js';
export const ALIPAY_PACKAGE = 'com.eg.android.AlipayGphone';
// The daily check-in campaign entry changes with promotions, so the entry
// keywords are configurable constants to allow easy tuning without code edits.
export const SIGNIN_KEYWORDS = ['签到', '领红包', '每日签到'];
export const SIGNIN_BUTTON_TEXT = ['签到', '立即签到', '今日签到', '去签到'];
export const SIGNIN_SUCCESS_TEXT = ['已签到', '连续签到', '领取成功', '获得', '签到成功'];
// Heuristic selectors only. Alipay is NOT installed on the current 1080x2208
// EMUI device yet, so every selector below is a best-effort guess and must be
// tuned against a real UI dump after the app is installed.
const SELECT = {
    searchEntry: [
        { desc: /搜索/ },
        { text: /搜索/ },
        { resourceId: /search/i },
    ],
};
export class AlipayAdapter {
    driver;
    memory;
    id = 'alipay';
    displayName = '支付宝';
    packageName = ALIPAY_PACKAGE;
    capabilities = new Set([
        'signin',
    ]);
    todos = [
        {
            capability: 'message',
            feature: 'alipay chat message and image',
            note: 'not implemented: chat flow needs a real-device UI dump; pending install and on-device verification',
        },
        {
            capability: 'feed',
            feature: 'life account feed',
            note: 'not implemented: feed entry unconfirmed; pending install and on-device verification',
        },
        {
            capability: 'live',
            feature: 'live stream',
            note: 'not implemented: live entry unconfirmed; pending install and on-device verification',
        },
    ];
    constructor(driver, memory) {
        this.driver = driver;
        this.memory = memory;
    }
    async initialize() { }
    async signIn() {
        try {
            await withRetry(() => openAndWait(this.driver, ALIPAY_PACKAGE, { timeoutMs: 25000 }), { attempts: 2, delayMs: 1500 });
            const already = await this.checkSuccessText();
            if (already) {
                await this.remember('signin', 'already signed in today');
                return okResult('already signed in', { status: 'already' });
            }
            await this.tapAny(SELECT.searchEntry, 8000);
            await typeIntoInput(this.driver, SIGNIN_KEYWORDS[0], undefined, {
                timeoutMs: 8000,
            });
            await sleep(1500);
            const entry = await waitFor(async () => {
                const obs = await this.driver.observe();
                return findNode(obs.roots, n => SIGNIN_KEYWORDS.some(k => n.text.includes(k) || n.desc.includes(k)));
            }, { timeoutMs: 12000 });
            await this.driver.tap(this.center(entry));
            await sleep(2000);
            const clicked = await this.tapSigninButton();
            if (!clicked) {
                await this.remember('signin', 'sign-in button not found');
                return failResult('sign-in entry not found on the campaign page');
            }
            await sleep(2000);
            const success = await this.checkSuccessText();
            if (!success) {
                await this.remember('signin', 'button clicked but success not confirmed');
                return failResult('sign-in clicked but success marker not confirmed');
            }
            await this.remember('signin', 'daily sign-in done');
            return okResult('daily sign-in done', { status: 'signed' });
        }
        catch (err) {
            return failResult(`signIn failed: ${this.errText(err)}`);
        }
    }
    async tapSigninButton() {
        for (const text of SIGNIN_BUTTON_TEXT) {
            const hit = await waitFor(async () => {
                const obs = await this.driver.observe();
                return findNode(obs.roots, n => n.text.includes(text) || n.desc.includes(text));
            }, { timeoutMs: 4000 }).catch(() => null);
            if (hit) {
                await this.driver.tap(this.center(hit));
                return true;
            }
        }
        return false;
    }
    async checkSuccessText() {
        const obs = await this.driver.observe();
        return (findNode(obs.roots, n => SIGNIN_SUCCESS_TEXT.some(t => n.text.includes(t) || n.desc.includes(t))) !== null);
    }
    async tapAny(candidates, timeoutMs = 8000) {
        let lastError = new Error('no selector candidate matched');
        for (const matcher of candidates) {
            try {
                await tapByMatcher(this.driver, matcher, {
                    timeoutMs,
                    intervalMs: 800,
                });
                return;
            }
            catch (err) {
                lastError = err;
            }
        }
        throw lastError;
    }
    center(node) {
        return {
            x: Math.round((node.bounds.left + node.bounds.right) / 2),
            y: Math.round((node.bounds.top + node.bounds.bottom) / 2),
        };
    }
    async remember(action, detail) {
        await this.memory.remember({
            kind: 'event',
            content: `Alipay ${action}: ${detail}`,
            tags: ['alipay', action],
        });
    }
    errText(err) {
        return err instanceof Error ? err.message : String(err);
    }
}
