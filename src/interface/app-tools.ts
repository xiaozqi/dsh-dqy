import { defineTool, type ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { Context } from '@deepseek-ai/cordis'
import { DeviceError, PolicyBlockedError } from '../domain/errors.js'
import type { PolicyRequest } from '../domain/policy-types.js'
import type { FishServices } from './tools.js'

export function registerAppTools(
  ctx: Context,
  services: FishServices,
): void {
  // Same policy as the core tools: a hard deadline per call, and no parallel
  // execution unless a tool is purely read-only.
  const register = (
    definition: ToolDefinition,
    concurrencySafe = false,
  ): void => {
    ctx.tools.register({
      ...definition,
      timeoutMs: definition.timeoutMs ?? services.toolTimeoutMs,
      isConcurrencySafe:
        definition.isConcurrencySafe ?? (() => concurrencySafe),
    })
  }

  // One gate call shared by the direct-service paths (they bypass the guarded
  // adapter registry because they hold the adapter instance itself).
  const gate = (request: PolicyRequest, what: string) => {
    const decision = services.runMode.decide(request)
    if (decision.verdict === 'block') {
      throw new PolicyBlockedError(
        'POLICY_BLOCKED',
        `${what} 被安全策略拦下：${decision.reasons.join('；')}`,
        decision.reasons,
      )
    }
    return decision
  }
  register(
    defineTool({
      name: 'fish_speak',
      description:
        'DQY speaks the given text aloud in her own voice. ' +
        'voice may be an edge-tts name or a cloned voice name from fish_clone_voice.',
      parameters: {
        text: {
          type: 'string',
          required: true,
          description: 'Text to say',
        },
        voice: {
          type: 'string',
          description:
            'Voice name: cloned voice or edge-tts name, defaults to her configured voice',
        },
      },
      output: {
        schema: { type: 'json' },
        render: (_args, value) => [
          {
            type: 'text',
            text: renderSpoken(value as unknown as SpokenView),
          },
        ],
      },
      async execute(args) {
        const spoken = await services.voice.speak(
          args.text,
          args.voice ?? undefined,
          true,
        )
        return { ...spoken }
      },
    }),
  )

  register(
    defineTool({
      name: 'fish_clone_voice',
      description:
        'Clone a voice from a speech sample so DQY can speak in it. ' +
        'Sample should be 5-10 seconds of clear, articulate speech.',
      parameters: {
        samplePath: {
          type: 'string',
          required: true,
          description:
            'Local audio file of the voice to clone (wav/mp3/m4a)',
        },
        name: {
          type: 'string',
          description:
            'Name for the cloned voice, defaults to "mine"',
        },
      },
      output: {
        schema: { type: 'json' },
        render: (_args, value) => [
          {
            type: 'text',
            text: renderClone(value as unknown as CloneView),
          },
        ],
      },
      async execute(args) {
        const clone = await services.voice.createVoice(
          args.samplePath,
          args.name ?? 'mine',
        )
        return { ...clone }
      },
    }),
  )

  register(
    defineTool({
      name: 'fish_listen',
      description:
        'DQY listens: recognize speech from a local audio file, or record the phone mic and transcribe it.',
      parameters: {
        audioPath: {
          type: 'string',
          description:
            'Local audio file to transcribe (wav preferred; mp3/mp4 needs ffmpeg)',
        },
        durationMs: {
          type: 'integer',
          description:
            'Record phone mic for this many ms and transcribe, defaults to 5000',
        },
      },
      output: {
        schema: { type: 'json' },
        render: (_args, value) => [
          {
            type: 'text',
            text: renderListen(value as unknown as ListenView),
          },
        ],
      },
      async execute(args) {
        if (args.audioPath) {
          const text = await services.voice.listen(args.audioPath)
          return { source: 'file', durationMs: 0, text }
        }
        const durationMs = args.durationMs ?? 5000
        const text = await services.voice.listenPhone(
          durationMs,
          services.adbPath,
          services.deviceSerial,
        )
        return { source: 'phone', durationMs, text }
      },
    }),
  )

  register(
    defineTool({
      name: 'fish_qq_voice_text',
      description:
        'Send the text as a QQ voice message in her own voice (experimental). ' +
        'The recipient must be named explicitly and must be whitelisted.',
      parameters: {
        peer: {
          type: 'string',
          required: true,
          description:
            'QQ friend / group name to speak into (must be in control.allowedPeers)',
        },
        text: {
          type: 'string',
          required: true,
          description: 'Text to synthesize and send as voice',
        },
        voice: {
          type: 'string',
          description: 'Optional edge-tts voice name',
        },
      },
      output: {
        schema: { type: 'json' },
        render: (_args, value) => [
          {
            type: 'text',
            text: renderVoiceText(
              value as unknown as VoiceTextView,
            ),
          },
        ],
      },
      async execute(args) {
        // The service re-checks the same gate: the tool-level call keeps the
        // work out of the device path, the service call keeps it enforced even
        // if another caller forgets.
        const result = await services.qq.sendVoiceWithText({
          peer: args.peer,
          text: args.text,
          voice: args.voice ?? undefined,
          authorize: input =>
            services.runMode.decide({
              app: 'qq',
              surface: 'voice',
              peer: input.peer,
              text: input.text,
            }),
        })
        return { ...result }
      },
    }),
  )
  register(
    defineTool({
      name: 'fish_ocr',
      description:
        'Read text on the current screen through OCR, with position of each text block.',
      parameters: {
        screenshotPath: {
          type: 'string',
          description:
            'Optional screenshot already returned by fish_observe; reusing it avoids a second capture',
        },
      },
      output: {
        schema: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              text: { type: 'string', required: true },
              confidence: { type: 'number', required: true },
              center: {
                type: 'object',
                required: true,
                additionalProperties: false,
                properties: {
                  x: { type: 'integer', required: true },
                  y: { type: 'integer', required: true },
                },
              },
            },
          },
        },
        render: (_args, value) => [
          {
            type: 'text',
            text:
              value.length > 0
                ? value.map(b => `- ${b.text}`).join('\n')
                : 'no text recognized',
          },
        ],
      },
      async execute(args) {
        const screenshotPath =
          args.screenshotPath ??
          (await services.device.observe()).screenshotPath
        const blocks = await services.vision.ocr(screenshotPath)
        return blocks.map(b => ({
          text: b.text,
          confidence: b.confidence,
          center: { ...b.center },
        }))
      },
    }),
  )

  register(
    defineTool({
      name: 'fish_qq_reply',
      description:
        'Open QQ, find unread conversations, read messages and send LLM-generated replies.',
      parameters: {
        maxConversations: {
          type: 'integer',
          description:
            'Maximum conversations to handle, defaults to 3',
        },
      },
      output: {
        schema: { type: 'json' },
        render: (_args, value) => [
          {
            type: 'text',
            text: renderReplies(value as unknown as ReplyView[]),
          },
        ],
      },
      async execute(args) {
        const replies = await services.qq.replyToUnread({
          maxConversations: args.maxConversations ?? 3,
          // Replies generated here never passed through the guarded adapter
          // registry, so the policy is enforced per reply.
          authorize: input =>
            services.runMode.decide({
              app: 'qq',
              surface: 'message',
              peer: input.peer,
              text: input.text,
            }),
        })
        return replies.map(r => ({
          peer: r.peer,
          reply: r.reply,
          sent: r.sent,
          incoming: r.incoming.map(m => ({ ...m })),
        }))
      },
    }),
  )

  register(
    defineTool({
      name: 'fish_douyin_feed',
      description:
        'Browse the Douyin feed: swipe through videos and like by keyword or probability.',
      parameters: {
        videos: {
          type: 'integer',
          description: 'Number of videos to watch, defaults to 10',
        },
        watchMs: {
          type: 'integer',
          description: 'Watch time per video in milliseconds',
        },
        likeProbability: {
          type: 'number',
          description: 'Random like probability between 0 and 1',
        },
        likeKeywords: {
          type: 'array',
          items: { type: 'string' },
          description: 'Keywords that force a like when matched on screen',
        },
      },
      output: {
        schema: { type: 'json' },
        render: (_args, value) => [
          {
            type: 'text',
            text: renderFeed(value as unknown as FeedView),
          },
        ],
      },
      async execute(args) {
        const session = await services.douyin.browseFeed({
          videos: args.videos ?? undefined,
          watchMs: args.watchMs ?? undefined,
          likeProbability: args.likeProbability ?? undefined,
          likeKeywords: args.likeKeywords ?? undefined,
        })
        return { ...session }
      },
    }),
  )

  register(
    defineTool({
      name: 'fish_douyin_interact',
      description:
        'Interact with the current Douyin video: like, comment, forward, or @ mention.',
      parameters: {
        action: {
          type: 'string',
          required: true,
          description:
            'One of: like, comment, forward, mention',
        },
        text: {
          type: 'string',
          description:
            'Comment text (comment) or extra text (mention)',
        },
        target: {
          type: 'string',
          description:
            'Share target label (forward) or friend name (mention)',
        },
      },
      output: {
        schema: { type: 'json' },
        render: (_args, value) => [
          {
            type: 'text',
            text: renderInteract(
              value as unknown as InteractView,
            ),
          },
        ],
      },
      async execute(args) {
        switch (args.action) {
          case 'like':
            return {
              ...(await services.douyin.likeCurrentVideo()),
            }
          case 'comment': {
            // A comment is public content: policy decides before the device
            // ever types it.
            const decision = gate(
              {
                app: 'douyin',
                surface: 'comment',
                text: args.text ?? '',
              },
              'douyin comment',
            )
            if (decision.verdict === 'dry-run') {
              return { action: 'comment', detail: 'dry-run: not sent', sent: false }
            }
            return {
              ...(await services.douyin.comment(args.text ?? '')),
            }
          }
          case 'forward': {
            const target = args.target ?? ''
            const decision = gate(
              { app: 'douyin', surface: 'share', peer: target },
              'douyin forward',
            )
            if (decision.verdict === 'dry-run') {
              return { action: 'forward', detail: 'dry-run: not sent', sent: false }
            }
            return {
              ...(await services.douyin.forward(target)),
            }
          }
          case 'mention': {
            const target = args.target ?? ''
            const decision = gate(
              {
                app: 'douyin',
                surface: 'mention',
                peer: target,
                text: args.text ?? '',
              },
              'douyin mention',
            )
            if (decision.verdict === 'dry-run') {
              return { action: 'mention', detail: 'dry-run: not sent', sent: false }
            }
            return {
              ...(await services.douyin.mention(
                target,
                args.text ?? '',
              )),
            }
          }
          default:
            throw new DeviceError(
              'DOUYIN_BAD_ACTION',
              `unknown interaction: ${args.action}`,
            )
        }
      },
    }),
  )

  register(
    defineTool({
      name: 'fish_play_game',
      description:
        'Run a template-driven game loop against the named template folder.',
      parameters: {
        game: {
          type: 'string',
          required: true,
          description: 'Game template folder id',
        },
        rounds: {
          type: 'integer',
          description: 'Maximum rounds, defaults to 30',
        },
        threshold: {
          type: 'number',
          description: 'Template match threshold, defaults to 0.85',
        },
      },
      output: {
        schema: { type: 'json' },
        render: (_args, value) => [
          {
            type: 'text',
            text: renderGame(value as unknown as GameView),
          },
        ],
      },
      async execute(args) {
        const run = await services.game.run({
          game: args.game,
          rounds: args.rounds ?? undefined,
          threshold: args.threshold ?? undefined,
        })
        return {
          game: run.game,
          rounds: run.rounds,
          finishedAt: run.finishedAt,
          steps: run.steps.map(s => ({
            action: s.action,
            reason: s.reason,
            target: s.target ?? '',
            point: s.point ? { ...s.point } : null,
          })),
        }
      },
    }),
  )

  register(
    defineTool({
      name: 'fish_schedule_status',
      description:
        'Show scheduled plans and the history of scheduled runs.',
      parameters: {},
      output: {
        schema: { type: 'json' },
        render: (_args, value) => [
          {
            type: 'text',
            text: JSON.stringify(value, null, 2),
          },
        ],
      },
      async execute() {
        return {
          plans: services.scheduler.listPlans().map(p => ({ ...p })),
          history: services.scheduler
            .listHistory()
            .map(t => ({ ...t })),
        }
      },
    }),
  )
}

interface ReplyView {
  peer: string
  reply: string
  sent: boolean
}

interface FeedView {
  watched: number
  liked: number
}

interface GameView {
  game: string
  rounds: number
}

interface InteractView {
  action: string
  detail: string
  sent: boolean
}

interface SpokenView {
  text: string
  audioPath: string
  durationMs: number
}

interface ListenView {
  source: string
  text: string
}

interface CloneView {
  name: string
  samplePath: string
  promptText: string
}

interface VoiceTextView {
  text: string
  durationMs: number
  sent: boolean
}

function renderReplies(value: ReplyView[]): string {
  if (value.length === 0) return 'no unread conversation handled'
  return value
    .map(r => `${r.peer}: ${r.sent ? 'sent' : 'failed'} -> ${r.reply}`)
    .join('\n')
}

function renderFeed(value: FeedView): string {
  return `watched ${value.watched} videos, liked ${value.liked}`
}

function renderGame(value: GameView): string {
  return `game ${value.game} finished after ${value.rounds} rounds`
}

function renderInteract(value: InteractView): string {
  return `${value.action} ${value.sent ? 'done' : 'failed'}: ${value.detail}`
}

function renderSpoken(value: SpokenView): string {
  return `spoken (${value.durationMs}ms): "${value.text}"`
}

function renderListen(value: ListenView): string {
  return value.text
    ? `heard: ${value.text}`
    : 'nothing recognized'
}

function renderClone(value: CloneView): string {
  return `voice "${value.name}" cloned (${value.promptText})`
}

function renderVoiceText(value: VoiceTextView): string {
  return `voice message ${value.sent ? 'sent' : 'not confirmed'} (${value.durationMs}ms): ${value.text}`
}
