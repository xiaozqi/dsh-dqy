export declare class AdbClient {
    private readonly adbPath;
    private serial?;
    constructor(adbPath: string, serial?: string | undefined);
    /**
     * Replace the serial after a wireless reconnect.
     *
     * A phone on `192.168.x.y:5555` comes back with a different address; the
     * serial resolved at plugin load is then dead and every call fails with
     * "device not found" until the harness restarts.
     */
    setSerial(serial: string): void;
    get currentSerial(): string | undefined;
    run(args: string[], timeoutMs?: number): Promise<string>;
    runBinary(args: string[], timeoutMs?: number): Promise<Buffer>;
    listDevices(): Promise<string[]>;
    private withSerial;
    private exec;
}
