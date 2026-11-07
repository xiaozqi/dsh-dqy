import type { Context } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
import type { SchedulePlan } from './domain/schedule-types.js';
export declare const name = "dqy";
export declare const inject: string[];
/** Normalized shape after schemastery defaults are applied. */
export interface NotificationRuleConfig {
    pattern: string;
    action: 'allow' | 'block';
    caseSensitive: boolean;
}
export interface NotificationsConfig {
    enabled: boolean;
    httpPort: number;
    /** Interface the notification bridge binds to. Loopback by default. */
    bindHost: string;
    /** Optional shared secret the phone-side bridge must send in `x-fish-token`. */
    token: string;
    maxBodyBytes: number;
    whitelist: string[];
    blockedApps: string[];
    minImportance: number;
    rules: NotificationRuleConfig[];
    semanticEnabled: boolean;
    dedupeWindowMs: number;
    /** Blocking (instead of allowing) an event whose filter chain threw. */
    failClosed: boolean;
}
export interface MirrorOptionsConfig {
    alwaysOnTop: boolean;
    windowWidth: number;
    turnScreenOff: boolean;
    audio: boolean;
    graceMs: number;
    reconnect: boolean;
}
export interface AutonomyConfig {
    enabled: boolean;
    heartbeatMs: number;
    minWakeMs: number;
    maxWakeMs: number;
    fallbackWakeMs: number;
    wakeOnEvent: boolean;
    guardEnabled: boolean;
    autoActions: string[];
    forbiddenActions: string[];
    /** Lifetime of a pending confirmation before it is dropped. */
    confirmTtlMs: number;
}
export interface SignInStepConfig {
    kind: string;
    target?: string;
    value?: string;
    durationMs?: number;
}
export interface SignInPlanConfig {
    app: string;
    appName: string;
    successText: string[];
    steps: SignInStepConfig[];
}
export interface ControlConfig {
    enabled: boolean;
    dryRun: boolean;
    /** Answer incoming QQ notifications without waiting for a tool call. */
    qqAutoReply: boolean;
    allowedPeers: string[];
    /** Owner's own chat accounts: tone only, never extra permission. */
    ownerPeers: string[];
    /** Second factor for owner commands; empty disables them. */
    ownerPassphrase: string;
    maxLength: number;
    blockUrl: boolean;
    recipeDir: string;
}
export interface FishConfig {
    adbPath: string;
    scrcpyPath: string;
    deviceSerial: string;
    llmBaseUrl: string;
    llmModel: string;
    apiKey: string;
    llmTimeoutMs: number;
    dataDir: string;
    pythonPath: string;
    voicePythonPath: string;
    visionThreshold: number;
    templateDir: string;
    voice: string;
    volcApiKey: string;
    volcAppId: string;
    volcAccessKey: string;
    volcResourceId: string;
    volcSpeaker: string;
    gptsovitsSrc: string;
    gptsovitsModelsDir: string;
    gptsovitsPythonPath: string;
    allowedApps: string[];
    forbiddenPackages: string[];
    maxSteps: number;
    /** Per-tool deadline; a hung adb/python call must never outlive it. */
    toolTimeoutMs: number;
    signInPlans: SignInPlanConfig[];
    schedules: SchedulePlan[];
    notifications: NotificationsConfig;
    mirror: MirrorOptionsConfig;
    autonomy: AutonomyConfig;
    control: ControlConfig;
}
/** Declared with an explicit annotation on purpose: see the note on `Config`. */
/**
 * Declared with an explicit annotation on purpose: the inferred type of a
 * schemastery object references internal cosmokit paths, which TypeScript
 * cannot name in the emitted `lib/index.d.ts` (TS2742). The output side is
 * the hand-written `FishConfig`, so `apply()` is fully typed.
 */
export declare const Config: z<any, FishConfig>;
export declare function apply(ctx: Context, config: FishConfig): void;
