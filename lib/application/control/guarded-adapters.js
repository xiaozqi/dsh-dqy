import { PolicyBlockedError } from '../../domain/errors.js';
// Capability methods whose call leaves the machine or speaks in public. Every
// other method (readConversation, browseFeed, signIn, ...) only moves the phone.
const GATED_METHODS = {
    message: [
        { method: 'sendMessage', surface: 'message' },
        { method: 'sendImage', surface: 'image' },
    ],
    moment: [{ method: 'publishMoment', surface: 'moment' }],
    social: [{ method: 'mention', surface: 'mention' }],
    comment: [
        { method: 'comment', surface: 'comment' },
        { method: 'replyComment', surface: 'comment' },
    ],
};
/** Which policy surface a capability/method pair belongs to. */
export function surfaceFor(capability, method) {
    const hit = GATED_METHODS[capability]?.find(item => item.method === method);
    if (hit) {
        return hit.surface;
    }
    // Legacy direct sends that are not modelled as a capability.
    if (method === 'sendVoiceWithText') {
        return 'voice';
    }
    return 'device';
}
function readInput(input) {
    if (input && typeof input === 'object') {
        return input;
    }
    return {};
}
/**
 * Decorates an adapter registry so that every outbound capability method is
 * decided by the single policy gate before the adapter runs.
 *
 * This is deliberate: tools, the autonomy loop and any future caller all reach
 * adapters through `getCapability()`, so a new caller cannot forget the gate.
 * A dry-run verdict returns a synthetic success without touching the device.
 */
export class GuardedAdapterRegistry {
    inner;
    options;
    constructor(inner, options) {
        this.inner = inner;
        this.options = options;
    }
    register(adapter) {
        this.inner.register(adapter);
    }
    list() {
        return this.inner.list();
    }
    get(id) {
        return this.inner.get(id);
    }
    listTodos() {
        return this.inner.listTodos();
    }
    getCapability(id, capability) {
        const capabilityObject = this.inner.getCapability(id, capability);
        const gated = GATED_METHODS[capability];
        if (!gated || !capabilityObject) {
            return capabilityObject;
        }
        // Policy identity is the package name, never the adapter id: notifications
        // and control.allowedPeers are keyed by package, so `qq` and
        // `com.tencent.mobileqq` must not be two different peers.
        const adapter = this.inner.get(id);
        const policyApp = adapter.packageName || id;
        return this.wrap(capabilityObject, policyApp, gated);
    }
    wrap(target, app, gated) {
        const surfaces = new Map(gated.map(item => [item.method, item.surface]));
        return new Proxy(target, {
            get: (object, property, receiver) => {
                const value = Reflect.get(object, property, receiver);
                if (typeof property !== 'string' || typeof value !== 'function') {
                    return value;
                }
                const surface = surfaces.get(property);
                if (!surface) {
                    return value;
                }
                return async (input) => {
                    const args = readInput(input);
                    const peer = typeof args.peer === 'string'
                        ? args.peer
                        : typeof args.friend === 'string'
                            ? args.friend
                            : undefined;
                    const request = {
                        app,
                        surface,
                        peer,
                        text: typeof args.text === 'string' ? args.text : '',
                    };
                    const decision = this.options.decide(request);
                    this.options.onDecision?.(request, decision);
                    if (decision.verdict === 'block') {
                        throw new PolicyBlockedError('POLICY_BLOCKED', `${app}/${surface} 被安全策略拦下：${decision.reasons.join('；')}`, decision.reasons);
                    }
                    if (decision.verdict === 'dry-run') {
                        return {
                            ok: true,
                            sent: false,
                            detail: `试运行（dry-run）：本来要调用 ${app}/${property}` +
                                (request.peer ? `，发给 ${request.peer}` : '') +
                                '，这次没有真发',
                            data: {
                                dryRun: true,
                                peer: request.peer ?? null,
                                text: request.text ?? '',
                            },
                        };
                    }
                    return value.call(object, input);
                };
            },
        });
    }
}
