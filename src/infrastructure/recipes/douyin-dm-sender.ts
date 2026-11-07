import { DeviceError } from '../../domain/errors.js'
import type {
  DirectMessageSender,
  DirectMessageSendInput,
} from '../../domain/ports/dm-sender.port.js'
import type { UiDriverPort } from '../../domain/ports/ui-driver.port.js'
import { centerOf, findNode, sleep, waitFor } from '../../application/support/wait-for.js'

export const DOUYIN_PACKAGE = 'com.ss.android.ugc.aweme'

const INPUT_HINT = /发消息或按住说话/
const SEND_BUTTON = /^发送$/

/**
 * Sends one Douyin direct message by driving the real UI.
 *
 * The declarative recipe assumed it always starts on the message list and taps
 * 「消息」→ peer row. In practice the app often resumes straight into the DM
 * chat (that is exactly when a notification fires), so the recipe timed out at
 * the first tap. This sender detects the current surface first, and only
 * navigates when it is not already in the right conversation.
 */
export class DouyinDmSender implements DirectMessageSender {
  constructor(private readonly driver: UiDriverPort) {}

  async send(input: DirectMessageSendInput): Promise<void> {
    if (input.app !== DOUYIN_PACKAGE) {
      throw new DeviceError(
        'DM_UNSUPPORTED',
        `DouyinDmSender cannot send for: ${input.app}`,
      )
    }
    const peer = input.peer.trim()
    const reply = input.reply.trim()
    if (!peer || !reply) {
      throw new DeviceError('DM_BAD_INPUT', 'peer and reply must not be empty')
    }

    await this.driver.connect()
    await this.driver.openApp(DOUYIN_PACKAGE)
    await waitFor(
      async () =>
        (await this.driver.foregroundApp()) === DOUYIN_PACKAGE ? true : null,
      { timeoutMs: 15000 },
    )
    await sleep(1500)

    if (!(await this.isPeerChat(peer))) {
      await this.openPeerChat(peer)
    }
    await this.typeAndSend(reply)
  }

  /** In the right conversation when the input bar is visible and the header names the peer. */
  private async isPeerChat(peer: string): Promise<boolean> {
    const observation = await this.driver.observe()
    const hasInput = findNode(
      observation.roots,
      node =>
        INPUT_HINT.test(node.text) ||
        INPUT_HINT.test(node.desc) ||
        node.className.includes('EditText'),
    )
    if (!hasInput) {
      return false
    }
    return (
      findNode(
        observation.roots,
        node => node.text.includes(peer) || node.desc.includes(peer),
      ) !== null
    )
  }

  private async openPeerChat(peer: string): Promise<void> {
    // Navigate to the message tab, backing out of any open chat first.
    for (let attempt = 0; attempt < 3; attempt++) {
      const observation = await this.driver.observe()
      const tab = findNode(
        observation.roots,
        node => node.text === '消息' || node.desc.includes('消息，按钮'),
      )
      if (tab) {
        await this.driver.tap(centerOf(tab))
        await sleep(1500)
        break
      }
      await this.driver.pressKey('back')
      await sleep(1000)
    }

    const row = await waitFor(
      async () => {
        const observation = await this.driver.observe()
        return findNode(
          observation.roots,
          node =>
            (node.desc || '').includes(peer) ||
            (node.text || '').includes(peer),
        )
      },
      { timeoutMs: 10000 },
    )
    await this.driver.tap(centerOf(row))
    await sleep(1500)
  }

  private async typeAndSend(reply: string): Promise<void> {
    const inputNode = await waitFor(
      async () => {
        const observation = await this.driver.observe()
        return findNode(
          observation.roots,
          node =>
            INPUT_HINT.test(node.text) ||
            INPUT_HINT.test(node.desc) ||
            node.className.includes('EditText'),
        )
      },
      { timeoutMs: 8000 },
    )
    await this.driver.tap(centerOf(inputNode))
    await sleep(600)
    // Douyin's input is Chinese; route through the IME channel, not `input text`.
    await this.driver.inputChinese(reply)
    await sleep(800)

    const sendButton = await waitFor(
      async () => {
        const observation = await this.driver.observe()
        return findNode(
          observation.roots,
          node => SEND_BUTTON.test(node.text) || SEND_BUTTON.test(node.desc),
        )
      },
      { timeoutMs: 5000 },
    ).then(
      node => node,
      () => null,
    )
    if (sendButton) {
      await this.driver.tap(centerOf(sendButton))
    } else {
      await this.driver.pressKey('enter')
    }

    // Only report success when the text is visible in the conversation.
    const probe = reply.slice(0, 10)
    const confirmed = await waitFor(
      async () => {
        const observation = await this.driver.observe()
        return findNode(
          observation.roots,
          node => (node.text || '').includes(probe),
        )
          ? true
          : null
      },
      { timeoutMs: 6000 },
    ).then(
      () => true,
      () => false,
    )
    if (!confirmed) {
      throw new DeviceError(
        'DM_SEND_UNCONFIRMED',
        'reply was typed but not observed in the conversation',
      )
    }
  }
}
