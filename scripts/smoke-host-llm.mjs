// Smoke test for the host-routed LlmPort: no apiKey, all calls go through a
// fake DSH runtime that only speaks the GenerateOptions/StreamChunk contract.
import { HostLlm, detectHostLlm } from '../lib/infrastructure/llm/host-llm.js'

const checks = []
function check(name, ok) {
  checks.push({ name, ok })
}

function makeRuntime({ providers = [{ id: 'deepseek', name: 'DeepSeek' }], models = { deepseek: [{ id: 'deepseek-chat', name: 'DeepSeek Chat' }] }, chunks = [] } = {}) {
  const seen = []
  return {
    seen,
    listProviders: () => providers,
    listModels: async provider => models[provider] ?? [],
    async *stream(options) {
      seen.push(options)
      for (const chunk of chunks) yield chunk
    },
  }
}

function textChunks(parts) {
  return parts.map((text, index) => ({ type: 'text-delta', index: 0, text }))
}

// T1: plain chat streams deltas and joins them.
{
  const runtime = makeRuntime({ chunks: textChunks(['hello ', 'world']) })
  const llm = new HostLlm({ runtime, preferredModel: 'deepseek-chat', timeoutMs: 5000 })
  const reply = await llm.chat([{ role: 'user', content: 'hi' }])
  check('T1 chat joins text deltas', reply === 'hello world')
  check('T1a route is deepseek/deepseek-chat', runtime.seen[0]?.provider === 'deepseek' && runtime.seen[0]?.model === 'deepseek-chat')
  check('T1b messages carry one user block', runtime.seen[0]?.messages?.length === 1 && runtime.seen[0].messages[0].role === 'user')
}

// T2: system text is lifted into options.system, not left as a message.
{
  const runtime = makeRuntime({ chunks: textChunks(['ok']) })
  const llm = new HostLlm({ runtime, preferredModel: 'deepseek-chat', timeoutMs: 5000 })
  await llm.chat([
    { role: 'system', content: 'you are a fish' },
    { role: 'user', content: 'hi' },
  ])
  const options = runtime.seen[0]
  check('T2 system lifted', options.system === 'you are a fish')
  check('T2a system not a message', options.messages.every(m => m.role !== 'system'))
}

// T3: decide parses the action JSON from streamed text.
{
  const json = JSON.stringify({ thought: 'look around', name: 'tap', args: { x: 10, y: 20 } })
  const runtime = makeRuntime({ chunks: textChunks([json]) })
  const llm = new HostLlm({ runtime, preferredModel: 'deepseek-chat', timeoutMs: 5000 })
  const action = await llm.decide([{ role: 'user', content: 'decide' }])
  check('T3 decide parses name', action.name === 'tap')
  check('T3a decide keeps args', action.args.x === 10 && action.args.y === 20)
}

// T4: preferred model missing from the catalog falls back to the first id.
{
  const runtime = makeRuntime({ chunks: textChunks(['x']) })
  const llm = new HostLlm({ runtime, preferredModel: 'not-there', timeoutMs: 5000 })
  await llm.chat([{ role: 'user', content: 'hi' }])
  check('T4 unknown preferred falls back', runtime.seen[0]?.model === 'deepseek-chat')
}

// T5: assistant history keeps provider provenance instead of becoming a user turn.
{
  const runtime = makeRuntime({ chunks: textChunks(['y']) })
  const llm = new HostLlm({ runtime, preferredModel: 'deepseek-chat', timeoutMs: 5000 })
  await llm.chat([
    { role: 'user', content: 'q' },
    { role: 'assistant', content: 'a' },
    { role: 'user', content: 'q2' },
  ])
  const roles = runtime.seen[0]?.messages.map(m => m.role)
  check('T5 assistant history preserved', roles.join(',') === 'user,assistant,user')
}

// T6: empty provider list is reported, not silently swallowed.
{
  const runtime = makeRuntime({ providers: [] })
  const llm = new HostLlm({ runtime, preferredModel: 'deepseek-chat', timeoutMs: 5000 })
  let failed = ''
  try {
    await llm.chat([{ role: 'user', content: 'hi' }])
  } catch (err) {
    failed = err?.code ?? 'no-code'
  }
  check('T6 no provider throws HOST_LLM_NO_PROVIDER', failed === 'HOST_LLM_NO_PROVIDER')
}

// T7: detectHostLlm ignores hosts without a usable runtime.
{
  const withRuntime = detectHostLlm({ llm: makeRuntime({ chunks: [] }) })
  const without = detectHostLlm({})
  const emptyProviders = detectHostLlm({ llm: makeRuntime({ providers: [] }) })
  check('T7 detect finds runtime', withRuntime !== null)
  check('T7a detect tolerates missing service', without === null)
  check('T7b detect rejects providerless runtime', emptyProviders === null)
}

const failedChecks = checks.filter(c => !c.ok)
for (const c of checks) console.log(`${c.ok ? 'PASS' : 'FAIL'} ${c.name}`)
if (failedChecks.length > 0) {
  console.error(`SMOKE_HOST_LLM_FAIL (${failedChecks.length})`)
  process.exitCode = 1
} else {
  console.log('SMOKE_HOST_LLM_OK')
}
