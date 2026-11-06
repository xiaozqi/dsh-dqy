import { LlmError } from '../../domain/errors.js';
import { parseActionContent } from './action-parser.js';
export class HttpLlm {
    config;
    constructor(config) {
        this.config = config;
    }
    async chat(messages) {
        const data = await this.request(messages, false);
        return data.choices?.[0]?.message?.content ?? '';
    }
    async chatJson(messages) {
        const data = await this.request(messages, true);
        return data.choices?.[0]?.message?.content ?? '';
    }
    async decide(messages) {
        const data = await this.request(messages, true);
        const content = data.choices?.[0]?.message?.content ?? '';
        return parseActionContent(content);
    }
    async request(messages, jsonMode) {
        if (!this.config.apiKey) {
            throw new LlmError('NO_API_KEY', 'apiKey missing in plugin config');
        }
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);
        try {
            const res = await fetch(`${this.config.baseUrl}/chat/completions`, {
                method: 'POST',
                headers: {
                    'content-type': 'application/json',
                    authorization: `Bearer ${this.config.apiKey}`,
                },
                body: JSON.stringify({
                    model: this.config.model,
                    messages,
                    temperature: 0.2,
                    ...(jsonMode
                        ? { response_format: { type: 'json_object' } }
                        : {}),
                }),
                signal: controller.signal,
            });
            if (!res.ok) {
                throw new LlmError('LLM_HTTP_ERROR', `HTTP ${res.status}: ${await res.text()}`);
            }
            return (await res.json());
        }
        catch (err) {
            if (err instanceof LlmError)
                throw err;
            throw new LlmError('LLM_REQUEST_FAILED', err.message);
        }
        finally {
            clearTimeout(timer);
        }
    }
}
