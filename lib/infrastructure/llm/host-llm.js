import { LlmError } from '../../domain/errors.js';
import { parseActionContent } from './action-parser.js';
function buildMessage(message, route, seq) {
    const text = [{ type: 'text', text: message.content }];
    if (message.role === 'assistant') {
        return {
            id: `dqy-${Date.now()}-${seq}`,
            role: 'assistant',
            content: text,
            source: { kind: 'model', provider: route.provider, model: route.model },
        };
    }
    return {
        id: `dqy-${Date.now()}-${seq}`,
        role: 'user',
        content: text,
        source: { kind: 'user' },
    };
}
/**
 * LlmPort backed by the DeepSeek Harness model channel (`ctx.llm`).
 *
 * When a plugin runs inside DSH the host already holds the provider route and
 * credentials, so this adapter borrows the host runtime instead of asking the
 * user for a second apiKey. The route is resolved lazily once and cached; a
 * DeepSeek route wins when several providers are registered.
 */
export class HostLlm {
    options;
    route = null;
    constructor(options) {
        this.options = options;
    }
    async chat(messages) {
        return this.complete(messages);
    }
    async chatJson(messages) {
        return this.complete(messages);
    }
    async decide(messages) {
        return parseActionContent(await this.complete(messages));
    }
    async resolveRoute() {
        if (this.route)
            return this.route;
        const runtime = this.options.runtime;
        const providers = runtime.listProviders();
        if (providers.length === 0) {
            throw new LlmError('HOST_LLM_NO_PROVIDER', 'host llm has no registered provider route');
        }
        const provider = providers.find(p => /deepseek/i.test(`${p.id} ${p.name}`)) ??
            providers[0];
        let modelIds = [];
        try {
            modelIds = (await runtime.listModels(provider.id)).map(m => m.id);
        }
        catch {
            modelIds = [];
        }
        const preferred = this.options.preferredModel.trim();
        const model = preferred && modelIds.includes(preferred)
            ? preferred
            : (modelIds[0] ?? preferred);
        if (!model) {
            throw new LlmError('HOST_LLM_NO_MODEL', `host provider ${provider.id} exposes no model id`);
        }
        this.route = { provider: provider.id, model };
        return this.route;
    }
    async complete(messages) {
        const route = await this.resolveRoute();
        const system = messages
            .filter(m => m.role === 'system')
            .map(m => m.content)
            .join('\n\n');
        const conversation = messages.filter(m => m.role !== 'system');
        const built = conversation.map((message, seq) => buildMessage(message, route, seq));
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), this.options.timeoutMs);
        let text = '';
        try {
            const request = {
                provider: route.provider,
                model: route.model,
                messages: built,
                temperature: 0.2,
                signal: controller.signal,
                ...(system ? { system } : {}),
            };
            for await (const chunk of this.options.runtime.stream(request)) {
                if (chunk.type === 'text-delta')
                    text += chunk.text;
            }
            if (text.trim().length === 0) {
                throw new LlmError('HOST_LLM_EMPTY', 'host llm returned no text content');
            }
            return text;
        }
        catch (err) {
            if (err instanceof LlmError)
                throw err;
            throw new LlmError('HOST_LLM_FAILED', err.message);
        }
        finally {
            clearTimeout(timer);
        }
    }
}
/**
 * Detect a usable host model runtime on the cordis context.
 *
 * Returns null when the plugin runs standalone or when the host has not
 * registered a provider yet, so callers can fall back to the HTTP adapter.
 */
export function detectHostLlm(ctx) {
    try {
        const candidate = ctx.llm;
        if (candidate &&
            typeof candidate.stream === 'function' &&
            typeof candidate.listProviders === 'function' &&
            candidate.listProviders().length > 0) {
            return candidate;
        }
    }
    catch {
        // A host without the llm service must not break plugin loading.
    }
    return null;
}
