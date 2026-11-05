export class DomainError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = new.target.name
  }
}

export class DeviceError extends DomainError {}

export class VisionError extends DomainError {}

export class LlmError extends DomainError {}

export class GuardrailError extends DomainError {}
export class VoiceError extends DomainError {}

export class AdapterError extends DomainError {}
export class UiNotFoundError extends AdapterError {}
export class DriverUnavailableError extends AdapterError {}
export class CapabilityNotImplementedError extends AdapterError {}
