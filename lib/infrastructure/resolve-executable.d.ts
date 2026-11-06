export interface ExecutableDiscovery {
    configured: string;
    command: string;
    wingetPattern?: RegExp;
    wingetExe?: string;
    extraCandidates?: string[];
}
export declare function resolveExecutable(discovery: ExecutableDiscovery): string;
