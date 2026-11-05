import type { AdapterResult, AdapterTodo, CapabilityId } from '../../domain/adapter-types.js'
import { failResult, okResult } from '../../domain/adapter-types.js'
import type { AppAdapter } from '../../domain/ports/app-adapter.port.js'
import type {
  CommentCapability,
  CommentInput,
  CommentItem,
} from '../../domain/ports/capabilities/comment.port.js'
import type { FeedCapability, FeedInput } from '../../domain/ports/capabilities/feed.port.js'
import type {
  MessageCapability,
  ConversationPreview,
  SendImageInput,
  SendMessageInput,
} from '../../domain/ports/capabilities/message.port.js'
import type {
  MentionInput,
  SocialCapability,
} from '../../domain/ports/capabilities/social.port.js'
import type { MemoryPort } from '../../domain/ports/memory.port.js'
import type { UiDriverPort, UiMatcher } from '../../domain/ports/ui-driver.port.js'
import type { UiNode } from '../../domain/types.js'
import {
  openAndWait,
  pushMedia,
  tapByMatcher,
  tapSend,
  typeIntoInput,
  waitAndTapPeer,
} from '../adapters/base-adapter.js'
import {
  centerOf,
  findNode,
  findNodes,
  sleep,
  waitFor,
  withRetry,
} from '../support/wait-for.js'

export const WEIBO_PACKAGE = 'com.sina.weibo'

// Heuristic selectors only. Weibo is NOT installed on the current 1080x2208
// EMUI device yet, so every selector below is a best-effort guess and must be
// tuned against a real UI dump after the app is installed.
const SELECT = {
  commentEntry: [
    { desc: /评论/ },
    { text: /评论/ },
    { resourceId: /comment/i },
  ] as UiMatcher[],
  likeButton: [
    { desc: /^赞$/ },
    { text: /^赞$/ },
    { resourceId: /like|praise|attitude/i },
  ] as UiMatcher[],
  messageTab: [
    { text: /^消息$/ },
    { desc: /消息/ },
  ] as UiMatcher[],
  replyEntry: [
    { text: /^回复$/ },
    { desc: /回复/ },
  ] as UiMatcher[],
  searchEntry: [
    { desc: /搜索/ },
    { text: /搜索/ },
  ] as UiMatcher[],
  plusButton: [
    { desc: /更多|加号/ },
    { text: /\+/ },
    { resourceId: /plus|more|add/i },
  ] as UiMatcher[],
  imageEntry: [
    { text: /^图片$/ },
    { desc: /图片/ },
  ] as UiMatcher[],
  sendText: [/^发送$/, /^回复$/, /^发布$/],
}

export class WeiboAdapter
  implements
    AppAdapter,
    FeedCapability,
    CommentCapability,
    SocialCapability,
    MessageCapability
{
  readonly id = 'weibo'
  readonly displayName = '微博'
  readonly packageName = WEIBO_PACKAGE
  readonly capabilities: ReadonlySet<CapabilityId> = new Set<CapabilityId>([
    'feed',
    'comment',
    'social',
    'message',
  ])
  readonly todos: readonly AdapterTodo[] = [
    {
      capability: 'social',
      feature: 'repost weibo',
      note: 'not implemented: repost panel target-picking flow needs a real-device UI dump; pending install and on-device verification',
    },
    {
      capability: 'social',
      feature: 'favorite / like state tracking',
      note: 'not implemented: favorite entry and liked-state detection need real-device selector tuning; pending install and on-device verification',
    },
    {
      capability: 'live',
      feature: 'live stream',
      note: 'not implemented: live player is a separate page; live capability not declared; pending install and on-device verification',
    },
    {
      capability: 'signin',
      feature: 'daily check-in',
      note: 'not implemented: check-in entry path unconfirmed; pending install and on-device verification',
    },
  ]

  // Each capability port declares its own literal tag; a combined adapter
  // satisfies all four simultaneously, so the tag type collapses to never.
  // The registry dispatches via the `capabilities` set, never this tag.
  declare readonly capability: never

  constructor(
    private readonly driver: UiDriverPort,
    private readonly memory: MemoryPort,
  ) {}

  async initialize(): Promise<void> {}

  async browseFeed(input: FeedInput = {}): Promise<AdapterResult> {
    const count = input.count ?? 10
    const watchMs = input.watchMs ?? 5000
    const keywords = input.likeKeywords ?? []
    try {
      await this.openWeibo()
      let liked = 0
      for (let i = 0; i < count; i++) {
        await sleep(watchMs)
        if (keywords.length > 0 && (await this.containsKeyword(keywords))) {
          await this.likeCurrent()
          liked++
        }
        await this.swipeUp()
        await sleep(1000)
      }
      await this.remember('feed', `browsed ${count} weibo, liked ${liked}`)
      return okResult(`feed done: watched ${count}, liked ${liked}`, {
        watched: count,
        liked,
      })
    } catch (err) {
      return failResult(`feed failed: ${this.errText(err)}`)
    }
  }

  async comment(input: CommentInput): Promise<AdapterResult> {
    try {
      await this.openWeibo()
      if (input.target) {
        try {
          await tapByMatcher(this.driver, { text: input.target }, { timeoutMs: 5000 })
        } catch {
          // target weibo not on screen; post comment on the current one
        }
      }
      await this.tapAny(SELECT.commentEntry, 8000)
      await sleep(1200)
      await typeIntoInput(this.driver, input.text, { className: /EditText/i }, { timeoutMs: 8000 })
      await tapSend(this.driver, { timeoutMs: 8000 })
      await this.remember('comment', input.text)
      return okResult('comment sent', { text: input.text })
    } catch (err) {
      return failResult(`comment failed: ${this.errText(err)}`)
    }
  }

  async replyComment(input: CommentInput): Promise<AdapterResult> {
    try {
      await this.openWeibo()
      // best-effort: open the comment panel if it is not already on screen
      try {
        await this.tapAny(SELECT.commentEntry, 3000)
        await sleep(1000)
      } catch {
        // comment panel assumed already open
      }
      const target = input.target
      if (target) {
        const row = await waitFor(
          async () => {
            const obs = await this.driver.observe()
            return findNode(obs.roots, n => n.text.includes(target))
          },
          { timeoutMs: 8000 },
        )
        await this.driver.tap(centerOf(row))
      } else {
        const row = await waitFor(
          async () => {
            const obs = await this.driver.observe()
            return findNode(obs.roots, n => n.text.length > 0 && n.clickable)
          },
          { timeoutMs: 6000 },
        )
        await this.driver.tap(centerOf(row))
      }
      await sleep(800)
      await this.tapAny(SELECT.replyEntry, 6000)
      await sleep(600)
      await typeIntoInput(this.driver, input.text, { className: /EditText/i }, { timeoutMs: 8000 })
      await tapSend(this.driver, { timeoutMs: 8000 })
      await this.remember('reply', input.text)
      return okResult('reply sent', { text: input.text })
    } catch (err) {
      return failResult(`reply failed: ${this.errText(err)}`)
    }
  }

  async browseComments(limit: number = 20): Promise<{ items: CommentItem[] }> {
    try {
      const obs = await this.driver.observe()
      const rows = findNodes(
        obs.roots,
        n =>
          n.text.length > 0 &&
          n.className.includes('TextView') &&
          !SELECT.sendText.some(re => re.test(n.text)),
      )
      const items: CommentItem[] = rows.slice(0, limit).map(n => ({
        author: '',
        text: n.text,
      }))
      return { items }
    } catch {
      return { items: [] }
    }
  }

  async mention(input: MentionInput): Promise<AdapterResult> {
    try {
      await this.openWeibo()
      await this.tapAny(SELECT.commentEntry, 8000)
      await sleep(1200)
      await typeIntoInput(this.driver, '@', undefined, { timeoutMs: 8000 })
      const friend = input.friend
      const candidate = await waitFor(
        async () => {
          const obs = await this.driver.observe()
          return findNode(
            obs.roots,
            n => n.text.includes(friend) || n.desc.includes(friend),
          )
        },
        { timeoutMs: 10000 },
      )
      await this.driver.tap(centerOf(candidate))
      await sleep(600)
      if (input.text) {
        await this.driver.inputText(` ${input.text}`)
        await sleep(300)
      }
      await tapSend(this.driver, { timeoutMs: 8000 })
      await this.remember('mention', `${friend}: ${input.text ?? ''}`)
      return okResult('mention sent', { friend, text: input.text ?? '' })
    } catch (err) {
      return failResult(`mention failed: ${this.errText(err)}`)
    }
  }

  async sendMessage(input: SendMessageInput): Promise<AdapterResult> {
    try {
      await this.openWeibo()
      await this.tapAny(SELECT.messageTab, 8000)
      await sleep(1500)
      await this.tapAny(SELECT.searchEntry, 6000)
      await typeIntoInput(this.driver, input.peer, undefined, { timeoutMs: 6000 })
      await waitAndTapPeer(this.driver, input.peer, { timeoutMs: 10000 })
      await typeIntoInput(this.driver, input.text, undefined, { timeoutMs: 8000 })
      await tapSend(this.driver, { timeoutMs: 8000 })
      await this.remember('message', `${input.peer}: ${input.text}`)
      return okResult(`message sent to ${input.peer}`, { peer: input.peer })
    } catch (err) {
      return failResult(`sendMessage failed: ${this.errText(err)}`)
    }
  }

  async sendImage(input: SendImageInput): Promise<AdapterResult> {
    try {
      await this.openWeibo()
      await this.tapAny(SELECT.messageTab, 8000)
      await sleep(1500)
      await this.tapAny(SELECT.searchEntry, 6000)
      await typeIntoInput(this.driver, input.peer, undefined, { timeoutMs: 6000 })
      await waitAndTapPeer(this.driver, input.peer, { timeoutMs: 10000 })
      await pushMedia(this.driver, input.localImagePath)
      await this.tapAny(SELECT.plusButton, 6000)
      await sleep(800)
      await this.tapAny(SELECT.imageEntry, 6000)
      await sleep(1200)
      const photo = await waitFor(
        async () => {
          const obs = await this.driver.observe()
          return findNode(
            obs.roots,
            n => n.clickable && n.className.includes('Image'),
          )
        },
        { timeoutMs: 8000 },
      )
      await this.driver.tap(centerOf(photo))
      await sleep(800)
      if (input.caption) {
        await typeIntoInput(this.driver, input.caption, undefined, { timeoutMs: 5000 })
      }
      await tapSend(this.driver, { timeoutMs: 8000 })
      await this.remember('image', `${input.peer}: ${input.localImagePath}`)
      return okResult(`image sent to ${input.peer}`, { peer: input.peer })
    } catch (err) {
      return failResult(`sendImage failed: ${this.errText(err)}`)
    }
  }

  async readConversation(
    peer?: string,
    limit: number = 20,
  ): Promise<ConversationPreview> {
    try {
      await this.openWeibo()
      await this.tapAny(SELECT.messageTab, 8000)
      await sleep(1500)
      if (peer) {
        await this.tapAny(SELECT.searchEntry, 6000)
        await typeIntoInput(this.driver, peer, undefined, { timeoutMs: 6000 })
        await waitAndTapPeer(this.driver, peer, { timeoutMs: 10000 })
      }
      const obs = await this.driver.observe()
      const bubbles = findNodes(
        obs.roots,
        n => n.text.length > 0 && n.className.includes('TextView'),
      )
      return {
        peer: peer ?? '',
        incoming: bubbles.map(n => n.text).slice(0, limit),
      }
    } catch {
      return { peer: peer ?? '', incoming: [] }
    }
  }

  private async openWeibo(): Promise<void> {
    await withRetry(
      () => openAndWait(this.driver, WEIBO_PACKAGE, { timeoutMs: 20000 }),
      { attempts: 2, delayMs: 1500 },
    )
  }

  private async tapAny(
    candidates: UiMatcher[],
    timeoutMs = 8000,
  ): Promise<UiNode> {
    let lastError: unknown = new Error('no selector candidate matched')
    for (const matcher of candidates) {
      try {
        return await tapByMatcher(this.driver, matcher, {
          timeoutMs,
          intervalMs: 800,
        })
      } catch (err) {
        lastError = err
      }
    }
    throw lastError
  }

  private async containsKeyword(keywords: string[]): Promise<boolean> {
    const obs = await this.driver.observe()
    return (
      findNode(
        obs.roots,
        n =>
          keywords.some(k => n.text.includes(k) || n.desc.includes(k)),
      ) !== null
    )
  }

  private async likeCurrent(): Promise<void> {
    try {
      await this.tapAny(SELECT.likeButton, 3000)
    } catch {
      const size = await this.driver.screenSize()
      const mid = {
        x: Math.round(size.width / 2),
        y: Math.round(size.height * 0.45),
      }
      await this.driver.tap(mid)
      await sleep(120)
      await this.driver.tap(mid)
      await sleep(500)
    }
  }

  private async swipeUp(): Promise<void> {
    const size = await this.driver.screenSize()
    const x = Math.round(size.width / 2)
    await this.driver.swipe(
      { x, y: Math.round(size.height * 0.78) },
      { x, y: Math.round(size.height * 0.25) },
      400,
    )
  }

  private async remember(action: string, detail: string): Promise<void> {
    await this.memory.remember({
      kind: 'event',
      content: `Weibo ${action}: ${detail}`,
      tags: ['weibo', action],
    })
  }

  private errText(err: unknown): string {
    return err instanceof Error ? err.message : String(err)
  }
}
