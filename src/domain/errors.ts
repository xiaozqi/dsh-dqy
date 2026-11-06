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

// Raised when the outbound policy refuses an action. Carries the machine
// readable reasons so tools can show why nothing was sent.
export class PolicyBlockedError extends AdapterError {
  constructor(
    code: string,
    message: string,
    readonly reasons: string[] = [],
  ) {
    super(code, message)
  }
}

// Raised when a device call outlives its deadline. Distinct from a transport
// error so callers can tell "the phone never answered" from "the phone said no".
export class DeviceTimeoutError extends DeviceError {}

