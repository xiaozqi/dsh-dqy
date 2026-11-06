export declare function keyguardSignals(dump: string): number;
export declare function isLocked(dump: string): boolean | null;
export declare function isAwake(dump: string): boolean | null;
export declare function isSecure(dump: string): boolean | null;
export declare function unlockScript(pin: string): string;
export declare function parseUnlockOutput(out: string): {
    actions: string;
    finalDump: string;
    steps: string[];
    already: boolean;
};
