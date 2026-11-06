export class DomainError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.code = code;
        this.name = new.target.name;
    }
}
export class DeviceError extends DomainError {
}
export class VisionError extends DomainError {
}
export class LlmError extends DomainError {
}
export class GuardrailError extends DomainError {
}
export class VoiceError extends DomainError {
}
export class AdapterError extends DomainError {
}
export class UiNotFoundError extends AdapterError {
}
export class DriverUnavailableError extends AdapterError {
}
export class CapabilityNotImplementedError extends AdapterError {
}
