export declare class AdbClient {
    private readonly adbPath;
    private readonly serial?;
    constructor(adbPath: string, serial?: string | undefined);
    run(args: string[], timeoutMs?: number): Promise<string>;
    runBinary(args: string[], timeoutMs?: number): Promise<Buffer>;
    listDevices(): Promise<string[]>;
    private withSerial;
    private exec;
}
