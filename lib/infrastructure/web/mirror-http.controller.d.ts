import type { MirrorPanelService } from '../../application/mirror/mirror-panel.service.js';
import type { WebServerPort } from '../../domain/ports/web-server.port.js';
export declare class MirrorHttpController {
    private readonly web;
    private readonly panel;
    private readonly base;
    private readonly token;
    private readonly tokenHeader;
    constructor(web: WebServerPort, panel: MirrorPanelService, base: string);
    register(): () => void;
    private guard;
    private registerInjection;
}
