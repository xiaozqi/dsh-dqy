import {
  failResult,
  okResult,
  type AdapterResult,
  type AdapterTodo,
  type CapabilityId,
} from '../../domain/adapter-types.js'
import type { AppAdapter } from '../../domain/ports/app-adapter.port.js'
import type {
  CommentInput,
  CommentItem,
  CommentCapability,
} from '../../domain/ports/capabilities/comment.port.js'
import type {
  FeedCapability,
  FeedInput,
} from '../../domain/ports/capabilities/feed.port.js'
import type {
  LiveCapability,
  WatchLiveInput,
} from '../../domain/ports/capabilities/live.port.js'
import type {
  ConversationPreview,
  MessageCapability,
  SendImageInput,
  SendMessageInput,
} from '../../domain/ports/capabilities/message.port.js'
import type {
  MentionInput,
  SocialCapability,
} from '../../domain/ports/capabilities/social.port.js'
import type { MemoryPort } from '../../domain/ports/memory.port.js'
import type {
  UiDriverPort,
  UiMatcher,
} from '../../domain/ports/ui-driver.port.js'
import type { Point, UiNode } from '../../domain/types.js'
import {
  findControl,
  openAndWait,
  pushMedia,
  tapSend,
  typeIntoInput,
  waitAndTapPeer,
} from '../adapters/base-adapter.js'
import {
  centerOf,
  sleep,
  waitFor,
  withRetry,
} from '../support/wait-for.js'

export const BILIBILI_PACKAGE = 'tv.danmaku.bili'

// NOTE: heuristics below target a generic EMUI build on a 1080x2208 phone.
// Text/desc/resourceId patterns are best-effort and MUST be re-calibrated on
// the real device with an actual UI dump before production runs.
const SELECTORS = {
  commentEntry: [
    { desc: /评论/ },
    { text: /评论/ },
    { resourceId: /comment/i },
  ] as UiMatcher[],
  // Real-device probe (Bili 9.17.0): the messages entry is the top-right
  // envelope icon (clickable FrameLayout, content-desc="消息,按钮"), NOT a
  // bottom tab — matching a bottom tab here would always time out.
  messageTab: [
    { desc: /^消息|消息,按钮/ },
    { resourceId: /message/i },
  ] as UiMatcher[],
  liveTab: [
    { text: /^直播$/ },
    { desc: /^直播/ },
    { resourceId: /live/i },
  ] as UiMatcher[],
  // Real-device probe: the at-rest comment bar has NO EditText yet — it is a
  // clickable View whose placeholder text rotates (seen: "新的风暴已经出现，
  // 你的妙评何时再现" and "轻轻敲醒沉睡的心灵，让我看看你的点评"), and the
  // placeholder TextView itself reports bounds [0,0][0,0]. Once opened, the
  // editor exposes a real EditText plus toolbar buttons.
  inputBox: [
    { className: /EditText/i },
    { text: /说点什么|发.*评论|新的风暴|妙评|沉睡的心灵|点评|输入/ },
    { desc: /说点什么|评论|新的风暴|妙评|沉睡的心灵|点评/ },
  ] as UiMatcher[],
  replyButton: [
    { text: /^回复$/ },
    { desc: /回复/ },
  ] as UiMatcher[],
  plusButton: [
    { text: /^\+$|^＋$|^更多$/ },
    { desc: /更多|加号|添加/ },
    { resourceId: /plus|more|add/i },
  ] as UiMatcher[],
  galleryEntry: [
    { text: /^图片$|^相册$/ },
    { desc: /图片|相册/ },
  ] as UiMatcher[],
  searchEntry: [
    { desc: /搜索/ },
    { text: /搜索/ },
    { resourceId: /search/i },
  ] as UiMatcher[],
}

export class BilibiliAdapter
  implements
    AppAdapter,
    FeedCapability,
    CommentCapability,
    SocialCapability,
    MessageCapability,
    LiveCapability
{
  readonly id = 'bilibili'
  readonly displayName = '哔哩哔哩'
  readonly packageName = BILIBILI_PACKAGE
  readonly capabilities: ReadonlySet<CapabilityId> = new Set<CapabilityId>([
    'feed',
    'comment',
    'social',
    'message',
    'live',
  ])
  // Discriminant collision: five capability ports each demand a literal
  // `capability` tag; `never` satisfies all of them at once.
  readonly capability!: never
  readonly todos: readonly AdapterTodo[] = [
    {
      capability: 'comment',
      feature: '点赞评论',
      note: 'like button inside comment rows not located; needs on-device UI dump to pin the selector before automation',
    },
    {
      capability: 'live',
      feature: '发送弹幕',
      note: 'danmaku input box inside the live room not wired; layout varies by room version, deferred pending real-device calibration',
    },
    {
      capability: 'live',
      feature: '赠送礼物',
      note: 'gift panel and currency guardrails not implemented; needs explicit confirmation flow before any spend',
    },
    {
      capability: 'social',
      feature: '关注UP主',
      note: 'follow button placement differs between feed cards and profile pages; deferred pending real-device calibration',
    },
    {
      capability: 'pet',
      feature: '投喂助手/碰一串',
      note: 'pet capability intentionally not registered on this adapter; B站助手入口 requires a separate UI flow',
    },
    {
      capability: 'signin',
      feature: '每日签到/投币',
      note: 'sign-in flow not implemented; needs mine-page entry and coin-spend guardrails first',
    },
    {
      capability: 'message',
      feature: '私信会话全流程',
      note: 'verified logged-in on Bili 9.17.0: envelope opens the 消息 page, but a fresh account only sees system tiles (回复与@/收到喜欢/新增粉丝) with an empty state — no peer conversation rows, so sendMessage/sendImage/readConversation time out by design until a real conversation exists; chat bubble fields and gallery picker remain unprobed',
    },
    {
      capability: 'social',
      feature: '@好友选择面板',
      note: 'the editor exposes a dedicated @ toolbar button; the fresh account has 0 follows so the friend panel renders empty — the current type-@ fallback is unverified against the real popup',
    },
  ]

  constructor(
    private readonly driver: UiDriverPort,
    private readonly memory: MemoryPort,
  ) {}

  async initialize(): Promise<void> {
    // No warm-up required; every capability method opens the app itself.
  }

  // ---------------------------------------------------------------- feed

  async browseFeed(input: FeedInput = {}): Promise<AdapterResult> {
    const count = input.count ?? 10
    const watchMs = input.watchMs ?? 6000
    const keywords = input.likeKeywords ?? []
    try {
      await withRetry(
        () => openAndWait(this.driver, BILIBILI_PACKAGE, { timeoutMs: 20000 }),
        { attempts: 3, delayMs: 1000 },
      )
      // Real-device probe (Bili 9.17.0, logged in): a grid card opens a
      // single-video detail page (UnitedBizDetailsActivity) — NOT a swipeable
      // immersive feed. Vertical swipes there only scroll the comment list,
      // so per iteration we enter one card, watch it, then press back to the
      // grid and pick the next card.
      await sleep(2000)
      const size = await this.driver.screenSize()
      const center: Point = {
        x: Math.round(size.width / 2),
        y: Math.round(size.height * 0.45),
      }
      let watched = 0
      let liked = 0
      for (let i = 0; i < count; i++) {
        await this.enterFirstGridCard()
        await sleep(1500)
        await sleep(watchMs)
        watched++
        if (keywords.length > 0 && (await this.hitKeywords(keywords))) {
          await this.doubleTap(center)
          liked++
        }
        await this.driver.pressKey('back')
        await sleep(900)
      }
      await this.remember('feed', `watched ${watched}, liked ${liked}`)
      return okResult(`browsed ${watched} videos, liked ${liked}`, {
        watched,
        liked,
      })
    } catch (err) {
      return failResult(`browseFeed failed: ${(err as Error).message}`)
    }
  }

  // ------------------------------------------------------------- comment

  async comment(input: CommentInput): Promise<AdapterResult> {
    try {
      if (!input.text) {
        return failResult('comment text is required')
      }
      await this.ensureCommentPanel()
      await this.tapAny(SELECTORS.inputBox, 10000)
      await sleep(400)
      await this.driver.inputText(input.text)
      await sleep(400)
      await tapSend(this.driver, { timeoutMs: 8000 })
      await sleep(600)
      await this.remember('comment', input.text)
      return okResult('comment sent', { sent: true, text: input.text })
    } catch (err) {
      return failResult(`comment failed: ${(err as Error).message}`)
    }
  }

  async replyComment(input: CommentInput): Promise<AdapterResult> {
    try {
      if (!input.text) {
        return failResult('reply text is required')
      }
      await this.ensureCommentPanel()
      const row = await this.findCommentRow(input.target)
      await this.driver.tap(centerOf(row))
      await sleep(500)
      await this.tapAny(SELECTORS.replyButton, 8000)
      await sleep(400)
      await this.driver.inputText(input.text)
      await sleep(400)
      await tapSend(this.driver, { timeoutMs: 8000 })
      await sleep(600)
      const detail = `${input.target ?? 'first comment'}: ${input.text}`
      await this.remember('reply', detail)
      return okResult('reply sent', { sent: true, target: input.target })
    } catch (err) {
      return failResult(`replyComment failed: ${(err as Error).message}`)
    }
  }

  async browseComments(limit = 20): Promise<{ items: CommentItem[] }> {
    try {
      await this.ensureCommentPanel()
      const items: CommentItem[] = []
      const seen = new Set<string>()
      const size = await this.driver.screenSize()
      for (
        let page = 0;
        page < 4 && items.length < limit;
        page++
      ) {
        const nodes = await this.driver.findNodes({})
        // Real-device probe: comment BODIES live in content-desc
        // (text='', desc='张萌纯是拉着马天宇来吃瓜的[doge]'); only author
        // names carry text. Collect every node that has either.
        const ordered = nodes
          .filter(n => n.text.length > 0 || n.desc.length > 0)
          .sort(
            (a, b) =>
              a.bounds.top - b.bounds.top || a.bounds.left - b.bounds.left,
          )
        for (const n of ordered) {
          const body = n.desc.length > 0 ? n.desc : n.text
          if (body.length < 10 || seen.has(body)) continue
          // Real-device probe: the author name Button overlaps the body
          // vertically (author [155,1136][299,1280] vs body top y=1247), so
          // match a short text node whose bottom sits within ~140px above to
          // 60px below the body top.
          const author =
            ordered.find(
              m =>
                m !== n &&
                m.text.length > 0 &&
                m.text.length <= 20 &&
                m.bounds.bottom > n.bounds.top - 140 &&
                m.bounds.bottom < n.bounds.top + 60 &&
                m.bounds.left <= n.bounds.left + 60,
            )?.text ?? 'unknown'
          seen.add(body)
          items.push({ author, text: body })
          if (items.length >= limit) break
        }
        await this.driver.swipe(
          {
            x: Math.round(size.width / 2),
            y: Math.round(size.height * 0.7),
          },
          {
            x: Math.round(size.width / 2),
            y: Math.round(size.height * 0.4),
          },
          300,
        )
        await sleep(800)
      }
      await this.remember('browse-comments', `collected ${items.length}`)
      return { items }
    } catch (err) {
      await this.remember('browse-comments', `failed: ${(err as Error).message}`)
      return { items: [] }
    }
  }

  // --------------------------------------------------------------- social

  async mention(input: MentionInput): Promise<AdapterResult> {
    try {
      if (!input.friend) {
        return failResult('mention friend is required')
      }
      await this.ensureCommentPanel()
      await this.tapAny(SELECTORS.inputBox, 10000)
      await sleep(400)
      await this.driver.inputText('@')
      await sleep(800)
      // TODO(real-device): B站 @-popup friend list row selector unverified.
      const friendNode = await this.findAny(
        [{ text: input.friend }, { desc: input.friend }],
        10000,
      )
      await this.driver.tap(centerOf(friendNode))
      await sleep(500)
      if (input.text) {
        await this.driver.inputText(` ${input.text}`)
        await sleep(300)
      }
      await tapSend(this.driver, { timeoutMs: 8000 })
      await sleep(600)
      const detail = `${input.friend}${input.text ? `: ${input.text}` : ''}`
      await this.remember('mention', detail)
      return okResult('mention sent', { sent: true, friend: input.friend })
    } catch (err) {
      return failResult(`mention failed: ${(err as Error).message}`)
    }
  }

  // ------------------------------------------------------------- message

  async sendMessage(input: SendMessageInput): Promise<AdapterResult> {
    try {
      if (!input.peer || !input.text) {
        return failResult('peer and text are required')
      }
      await withRetry(
        () => openAndWait(this.driver, BILIBILI_PACKAGE, { timeoutMs: 20000 }),
        { attempts: 3, delayMs: 1000 },
      )
      await this.tapAny(SELECTORS.messageTab, 12000)
      await sleep(1200)
      await waitAndTapPeer(this.driver, input.peer, { timeoutMs: 10000 })
      await sleep(800)
      await typeIntoInput(
        this.driver,
        input.text,
        { className: /EditText/i },
        { timeoutMs: 8000 },
      )
      await tapSend(this.driver, { timeoutMs: 8000 })
      await sleep(500)
      await this.remember('send-message', `${input.peer}: ${input.text}`)
      return okResult('message sent', { sent: true, peer: input.peer })
    } catch (err) {
      return failResult(`sendMessage failed: ${(err as Error).message}`)
    }
  }

  async sendImage(input: SendImageInput): Promise<AdapterResult> {
    try {
      if (!input.peer || !input.localImagePath) {
        return failResult('peer and localImagePath are required')
      }
      await withRetry(
        () => openAndWait(this.driver, BILIBILI_PACKAGE, { timeoutMs: 20000 }),
        { attempts: 3, delayMs: 1000 },
      )
      await this.tapAny(SELECTORS.messageTab, 12000)
      await sleep(1000)
      await waitAndTapPeer(this.driver, input.peer, { timeoutMs: 10000 })
      await sleep(800)
      if (input.caption) {
        await typeIntoInput(
          this.driver,
          input.caption,
          { className: /EditText/i },
          { timeoutMs: 8000 },
        )
      }
      await pushMedia(this.driver, input.localImagePath)
      await this.tapAny(SELECTORS.plusButton, 8000)
      await sleep(800)
      await this.tapAny(SELECTORS.galleryEntry, 8000)
      await sleep(1000)
      // TODO(real-device): gallery order cannot be guaranteed by path; we
      // select the first thumbnail, which must be re-verified on device.
      await this.tapFirstGalleryThumb()
      await sleep(500)
      await tapSend(this.driver, { timeoutMs: 8000 })
      await sleep(600)
      await this.remember('send-image', `${input.peer}: ${input.localImagePath}`)
      return okResult('image sent', { sent: true, peer: input.peer })
    } catch (err) {
      return failResult(`sendImage failed: ${(err as Error).message}`)
    }
  }

  async readConversation(
    peer?: string,
    limit = 20,
  ): Promise<ConversationPreview> {
    try {
      if (peer) {
        await withRetry(
          () =>
            openAndWait(this.driver, BILIBILI_PACKAGE, { timeoutMs: 20000 }),
          { attempts: 2, delayMs: 1000 },
        )
        await this.tapAny(SELECTORS.messageTab, 12000)
        await sleep(1000)
        await waitAndTapPeer(this.driver, peer, { timeoutMs: 10000 })
        await sleep(800)
      }
      const nodes = await this.driver.findNodes({})
      // TODO(real-device): incoming vs outgoing bubbles cannot be told apart
      // from text alone; needs resourceId calibration on a real dump.
      const incoming = [
        ...new Set(
          nodes.map(n => n.text).filter(t => t.length > 0 && t !== peer),
        ),
      ].slice(-limit)
      await this.remember('read-conversation', `read ${incoming.length} messages`)
      return { peer: peer ?? 'current', incoming }
    } catch (err) {
      await this.remember('read-conversation', `failed: ${(err as Error).message}`)
      return { peer: peer ?? 'unknown', incoming: [] }
    }
  }

  // ------------------------------------------------------------------ live

  async watchLive(input: WatchLiveInput = {}): Promise<AdapterResult> {
    const durationMs = input.durationMs ?? 8000
    try {
      await withRetry(
        () => openAndWait(this.driver, BILIBILI_PACKAGE, { timeoutMs: 20000 }),
        { attempts: 3, delayMs: 1000 },
      )
      await this.tapAny(SELECTORS.liveTab, 12000)
      await sleep(1500)
      if (input.anchor) {
        await this.tapAny(SELECTORS.searchEntry, 8000)
        await sleep(600)
        await typeIntoInput(this.driver, input.anchor, undefined, {
          timeoutMs: 8000,
        })
        await this.driver.pressKey('enter')
        await sleep(1500)
        const room = await this.findAny(
          [{ text: input.anchor }, { desc: input.anchor }],
          10000,
        )
        await this.driver.tap(centerOf(room))
      } else {
        // Real-device probe: after tapping the live tab we land on a
        // two-column stream of room cover cards. Re-matching SELECTORS.liveTab
        // would re-hit the already-selected top tab (desc="直播,7之1,标签")
        // and never enter a room — tap a room card below the tab strip.
        await this.tapFirstGridCard(400, 8000)
      }
      await sleep(1500)
      await sleep(durationMs)
      await this.remember(
        'watch-live',
        `${input.anchor ?? 'first room'} for ${durationMs}ms`,
      )
      return okResult(
        `watched live ${input.anchor ?? 'room'} for ${durationMs}ms`,
        { anchor: input.anchor ?? null, durationMs },
      )
    } catch (err) {
      return failResult(`watchLive failed: ${(err as Error).message}`)
    }
  }

  // --------------------------------------------------------------- helpers

  private async ensureCommentPanel(): Promise<void> {
    await withRetry(
      async () => {
        await this.tapAny(SELECTORS.commentEntry, 8000)
        await sleep(1000)
        // Verify the panel opened by waiting for an input box.
        await findControl(
          this.driver,
          { className: /EditText/i },
          { timeoutMs: 3000 },
        )
      },
      { attempts: 2, delayMs: 800 },
    )
  }

  private async findAny(
    matchers: UiMatcher[],
    timeoutMs: number,
  ): Promise<UiNode> {
    return waitFor(
      async () => {
        for (const matcher of matchers) {
          const nodes = await this.driver.findNodes(matcher)
          if (nodes.length > 0) return nodes[0]
        }
        return null
      },
      { timeoutMs, intervalMs: 700 },
    )
  }

  private async tapAny(
    matchers: UiMatcher[],
    timeoutMs: number,
  ): Promise<UiNode> {
    const node = await this.findAny(matchers, timeoutMs)
    await this.driver.tap(centerOf(node))
    await sleep(600)
    return node
  }

  private async findCommentRow(target?: string): Promise<UiNode> {
    return waitFor(
      async () => {
        if (target) {
          const hits = await this.driver.findNodes({ text: target })
          if (hits.length > 0) return hits[0]
        }
        // Heuristic: first comment row — body text may live in desc.
        const all = await this.driver.findNodes({})
        const row = all.find(
          n => n.text.length > 8 || n.desc.length > 12,
        )
        return row ?? null
      },
      { timeoutMs: 8000, intervalMs: 700 },
    )
  }

  private async tapFirstGridCard(
    minTop: number,
    timeoutMs: number,
  ): Promise<void> {
    // Probe: cover ImageViews are clickable=false; the clickable parent card
    // spans the whole tile. Pick the first clickable tile below the top tab
    // strip and tap its center.
    const node = await waitFor(
      async () => {
        const size = await this.driver.screenSize()
        const all = await this.driver.findNodes({})
        const card = all.find(
          n =>
            n.clickable &&
            n.bounds.top >= minTop &&
            n.bounds.top > size.height * 0.15 &&
            n.bounds.right - n.bounds.left > size.width * 0.3 &&
            n.bounds.bottom - n.bounds.top > size.height * 0.08,
        )
        return card ?? null
      },
      { timeoutMs, intervalMs: 700 },
    )
    await this.driver.tap(centerOf(node))
    await sleep(1200)
  }

  private async enterFirstGridCard(): Promise<void> {
    try {
      await this.tapFirstGridCard(360, 4000)
    } catch {
      // No grid card visible: already inside the player, proceed.
    }
  }

  private async tapFirstGalleryThumb(): Promise<void> {
    const node = await waitFor(
      async () => {
        const size = await this.driver.screenSize()
        const all = await this.driver.findNodes({})
        const thumb = all.find(
          n =>
            n.clickable &&
            n.bounds.top > size.height * 0.2 &&
            n.bounds.bottom < size.height * 0.85 &&
            n.bounds.right - n.bounds.left < size.width * 0.6,
        )
        return thumb ?? null
      },
      { timeoutMs: 8000, intervalMs: 700 },
    )
    await this.driver.tap(centerOf(node))
  }

  private async hitKeywords(keywords: string[]): Promise<boolean> {
    const nodes = await this.driver.findNodes({})
    return nodes.some(n =>
      keywords.some(
        k => n.text.includes(k) || n.desc.includes(k),
      ),
    )
  }

  private async doubleTap(at: Point): Promise<void> {
    await this.driver.tap(at)
    await sleep(120)
    await this.driver.tap(at)
    await sleep(600)
  }

  private async remember(action: string, detail: string): Promise<void> {
    await this.memory.remember({
      kind: 'event',
      content: `Bilibili ${action}: ${detail}`,
      tags: ['bilibili', action],
    })
  }
}
