import type { AgentLoop } from '../application/agent-loop.js';
import { SignInService } from '../application/tasks/signin.task.js';
import type { Context } from '@deepseek-ai/cordis';
import type { ConfirmationQueue } from '../application/control/confirmation-queue.js';
import { DouyinService } from '../application/apps/douyin.service.js';
import { GameService } from '../application/apps/game.service.js';
import { QqService } from '../application/apps/qq.service.js';
import { DailyScheduler } from '../application/scheduler/daily-scheduler.js';
import type { AppAdapterRegistry } from '../domain/ports/app-adapter.port.js';
import type { DevicePort } from '../domain/ports/device.port.js';
import type { MemoryPort } from '../domain/ports/memory.port.js';
import type { NotificationPort } from '../domain/ports/notification.port.js';
import type { VisionPort } from '../domain/ports/vision.port.js';
import type { VoicePort } from '../domain/ports/voice.port.js';
import type { RunModePort } from '../domain/ports/run-mode.port.js';
import type { MessageStatePort } from '../domain/ports/message-state.port.js';
import type { DmWatchPipeline } from '../application/control/dm-watch-pipeline.js';
import type { MirrorPanelService } from '../application/mirror/mirror-panel.service.js';
export interface ReplyHealth {
    qq: {
        enabled: boolean;
        busy: boolean;
        queued: number;
        queueLimit: number;
        watchMs: number;
        ownerPeers: string[];
    };
    douyin: {
        enabled: boolean;
        dryRun: boolean;
        dedupeWindowMs: number;
        lastOutcomes: {
            app: string;
            phase: string;
            at: string;
            error: string;
        }[];
    };
    recentFailures: {
        at: string;
        content: string;
    }[];
}
export interface FishServices {
    loop: AgentLoop;
    signin: SignInService;
    device: DevicePort;
    memory: MemoryPort;
    vision: VisionPort;
    voice: VoicePort;
    qq: QqService;
    douyin: DouyinService;
    game: GameService;
    scheduler: DailyScheduler;
    adapters: AppAdapterRegistry;
    adbPath: string;
    deviceSerial: string;
    notifications: NotificationPort;
    runMode: RunModePort;
    messageState: MessageStatePort;
    dmWatch: DmWatchPipeline;
    mirror: MirrorPanelService;
    confirmations: ConfirmationQueue;
    /** Default deadline for one tool call, from the plugin config. */
    toolTimeoutMs: number;
    /** One-screen, user-facing answer to "why is she not talking?". */
    describePolicy(): string;
    /** Auto-reply health for QQ and Douyin, for one-glance diagnosis. */
    replyHealth(): Promise<ReplyHealth>;
}
export declare function registerTools(ctx: Context, services: FishServices): void;
