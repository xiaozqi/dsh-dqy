import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { matches } from '../lib/domain/ports/ui-driver.port.js'
import { centerOf } from '../lib/application/support/wait-for.js'
import { FileStateStore } from '../lib/infrastructure/state/file-state-store.js'
import { OutboundGuard, peerKey } from '../lib/application/control/outbound-guard.js'
import { RunMode } from '../lib/application/control/run-mode.js'
import { MessageStateStore } from '../lib/application/control/message-state-store.js'
import { RecipeLoader } from '../lib/infrastructure/recipes/recipe-loader.js'
import { RecipeExecutor } from '../lib/application/recipes/recipe-executor.js'
import { RecipeDirectMessageSender } from '../lib/infrastructure/recipes/recipe-dm-sender.js'
import { DmWatchPipeline } from '../lib/application/control/dm-watch-pipeline.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const PKG_ROOT = resolve(HERE, '..')
export const PKG = 'com.ss.android.ugc.aweme'

function makeNode(partial) {
  return {
    text: '',
    desc: '',
    resourceId: '',
    className: 'android.view.View',
    packageName: PKG,
    clickable: false,
    enabled: true,
    bounds: { left: 0, top: 0, right: 100, bottom: 100 },
    children: [],
    ...partial,
  }
}

// Deterministic LLM stand-in. It records every prompt so tests can assert the
// isolated decision context, and returns a canned JSON decision string.
export class FakeLlm {
  constructor({ shouldReply = true, reply = '', fail = false } = {}) {
    this.shouldReply = shouldReply
    this.reply = reply
    this.fail = fail
    this.received = []
  }

  async chat(messages) {
    this.received.push(messages)
    if (this.fail) throw new Error('fake llm failure')
    if (!this.shouldReply) return '{"shouldReply":false}'
    return JSON.stringify({ shouldReply: true, reply: this.reply })
  }

  async decide() {
    throw new Error('decide() is not used by the watch pipeline')
  }
}

// In-memory phone. It models two pages (message list, conversation) and the
// selectors are matched with the real production `matches` helper, so selector
// behaviour is identical to a device. Taps drive simple page transitions.
export class FakeUiDriver {
  constructor(peer) {
    this.kind = 'fake'
    this.peer = peer
    this.connected = false
    this.foreground = ''
    this.page = 'list'
    this.calls = []
    this.inputs = []
    this.tappedResourceIds = []
    this.lastInput = ''

    this.listNodes = [
      makeNode({
        text: '消息',
        resourceId: 'tab_message',
        clickable: true,
        bounds: { left: 0, top: 2000, right: 360, bottom: 2100 },
      }),
      makeNode({
        text: peer,
        resourceId: 'conversation_item',
        clickable: true,
        bounds: { left: 0, top: 300, right: 1080, bottom: 450 },
      }),
    ]
    this.conversationNodes = [
      makeNode({
        text: '',
        className: 'android.widget.EditText',
        resourceId: 'edit_text',
        clickable: true,
        bounds: { left: 20, top: 2100, right: 800, bottom: 2250 },
      }),
      makeNode({
        text: '发送',
        resourceId: 'send_button',
        clickable: true,
        bounds: { left: 820, top: 2100, right: 1060, bottom: 2250 },
      }),
    ]
  }

  // DevicePort
  async connect() {
    this.connected = true
  }

  async isConnected() {
    return this.connected
  }

  async screenSize() {
    return { width: 1080, height: 2310 }
  }

  async foregroundApp() {
    return this.foreground
  }

  async openApp(packageName) {
    this.calls.push(['openApp', packageName])
    this.foreground = packageName
    this.page = 'list'
    this.lastInput = ''
    // Reset the conversation page to its controls, dropping prior bubbles.
    this.conversationNodes = this.conversationNodes.filter(
      node =>
        node.resourceId === 'edit_text' || node.resourceId === 'send_button',
    )
  }

  async tap(point) {
    this.calls.push(['tap', point])
    const hit = this.currentNodes().find(
      node =>
        node.clickable &&
        point.x >= node.bounds.left &&
        point.x <= node.bounds.right &&
        point.y >= node.bounds.top &&
        point.y <= node.bounds.bottom,
    )
    if (!hit) return
    this.tappedResourceIds.push(hit.resourceId)
    switch (hit.resourceId) {
      case 'tab_message':
        this.page = 'list'
        break
      case 'conversation_item':
        this.page = 'conversation'
        break
      case 'send_button':
        // Model the sent reply appearing as an outgoing bubble in the thread.
        this.conversationNodes.push(
          makeNode({
            text: this.lastInput,
            resourceId: 'bubble_self',
            bounds: { left: 400, top: 1800, right: 1040, bottom: 1950 },
          }),
        )
        break
    }
  }

  async longPress(point, durationMs) {
    this.calls.push(['longPress', point, durationMs])
  }

  async swipe(from, to, durationMs) {
    this.calls.push(['swipe', from, to, durationMs])
  }

  async inputText(text) {
    this.calls.push(['inputText', text])
    this.inputs.push({ chinese: false, text })
    this.lastInput = text
  }

  async inputChinese(text) {
    this.calls.push(['inputChinese', text])
    this.inputs.push({ chinese: true, text })
    this.lastInput = text
  }

  async pressKey(key) {
    this.calls.push(['pressKey', key])
  }

  async observe() {
    return {
      screenshotPath: '<fake-screenshot>',
      foregroundApp: this.foreground,
      screenSize: { width: 1080, height: 2310 },
      roots: this.currentNodes(),
      capturedAt: new Date().toISOString(),
    }
  }

  async findText(text) {
    const node = this.currentNodes().find(n => n.text.includes(text))
    return node ? centerOf(node) : null
  }

  async pushFile() {}

  async pullFile() {}

  async playAudio() {}

  async recordAudio() {}

  // UiDriverPort
  async findNodes(matcher) {
    return this.currentNodes().filter(node => matches(node, matcher))
  }

  async tapControl(matcher) {
    const node = (await this.findNodes(matcher))[0]
    if (!node) throw new Error('UI_NOT_FOUND in fake driver')
    await this.tap(centerOf(node))
    return node
  }

  currentNodes() {
    return this.page === 'list' ? this.listNodes : this.conversationNodes
  }
}

// Wires the real production classes with the fake driver and LLM, mirroring
// the composition root without any device or network dependency.
export function buildHarness(options = {}) {
  const {
    stateDir,
    peer = '张三',
    peers = [],
    recipeDir = resolve(PKG_ROOT, 'assets/recipes'),
    llm = new FakeLlm({ shouldReply: true, reply: '你好，我在' }),
  } = options

  const store = new FileStateStore(resolve(stateDir, 'state'))
  const allowedPeers = new Set(peers.map(name => peerKey(PKG, name)))
  const guard = new OutboundGuard({
    allowedPeers,
    maxLength: 500,
    blockUrl: true,
  })
  const runMode = new RunMode(store, guard)
  const messageState = new MessageStateStore(store)

  const recipes = new RecipeLoader(recipeDir).loadAll()
  const driver = new FakeUiDriver(peer)
  const executor = new RecipeExecutor(driver)
  const sender = new RecipeDirectMessageSender(executor, recipes)
  const dmWatch = new DmWatchPipeline(messageState, runMode, llm, sender, {
    dedupeWindowMs: 60000,
  })

  return { store, driver, llm, runMode, messageState, dmWatch }
}

export function makeEvent(peer, text, when = 1760000000000) {
  return {
    id: 'n1',
    app: PKG,
    title: peer,
    text,
    when,
    importance: 4,
    source: 'fake',
  }
}
