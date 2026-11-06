import type { AdapterResult, AdapterTodo, CapabilityId } from '../../domain/adapter-types.js';
import type { AppAdapter } from '../../domain/ports/app-adapter.port.js';
import type { SignInCapability } from '../../domain/ports/capabilities/signin.port.js';
import type { MemoryPort } from '../../domain/ports/memory.port.js';
import type { UiDriverPort } from '../../domain/ports/ui-driver.port.js';
export declare const ALIPAY_PACKAGE = "com.eg.android.AlipayGphone";
export declare const SIGNIN_KEYWORDS: string[];
export declare const SIGNIN_BUTTON_TEXT: string[];
export declare const SIGNIN_SUCCESS_TEXT: string[];
export declare class AlipayAdapter implements AppAdapter, SignInCapability {
    private readonly driver;
    private readonly memory;
    readonly id = "alipay";
    readonly displayName = "\u652F\u4ED8\u5B9D";
    readonly packageName = "com.eg.android.AlipayGphone";
    readonly capabilities: ReadonlySet<CapabilityId>;
    readonly todos: readonly AdapterTodo[];
    readonly capability: never;
    constructor(driver: UiDriverPort, memory: MemoryPort);
    initialize(): Promise<void>;
    signIn(): Promise<AdapterResult>;
    private tapSigninButton;
    private checkSuccessText;
    private tapAny;
    private center;
    private remember;
    private errText;
}
