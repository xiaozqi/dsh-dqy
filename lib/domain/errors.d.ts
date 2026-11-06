export declare class DomainError extends Error {
    readonly code: string;
    constructor(code: string, message: string);
}
export declare class DeviceError extends DomainError {
}
export declare class VisionError extends DomainError {
}
export declare class LlmError extends DomainError {
}
export declare class GuardrailError extends DomainError {
}
export declare class VoiceError extends DomainError {
}
export declare class AdapterError extends DomainError {
}
export declare class UiNotFoundError extends AdapterError {
}
export declare class DriverUnavailableError extends AdapterError {
}
export declare class CapabilityNotImplementedError extends AdapterError {
}
export declare class PolicyBlockedError extends AdapterError {
    readonly reasons: string[];
    constructor(code: string, message: string, reasons?: string[]);
}
export declare class DeviceTimeoutError extends DeviceError {
}
