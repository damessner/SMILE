/**
 * Error contract for the WebUntis integration.
 *
 * WebUntis used to answer every failure with an empty list, so an outage, a
 * permission problem and a genuinely empty day were indistinguishable in the
 * UI. That is the same "silent zero" failure recorded in
 * docs/history/invariants-history.md (Invariant 1). Callers now have to decide
 * explicitly what to show.
 */
export type WebUntisErrorCode =
  | 'WEBUNTIS_NOT_CONNECTED'
  | 'WEBUNTIS_AUTH_FAILED'
  | 'WEBUNTIS_UNAVAILABLE'
  | 'WEBUNTIS_PERMISSION_DENIED'
  | 'WEBUNTIS_INVALID_REQUEST'
  | 'WEBUNTIS_HOST_NOT_ALLOWED';

const STATUS_BY_CODE: Record<WebUntisErrorCode, number> = {
  WEBUNTIS_NOT_CONNECTED: 409,
  WEBUNTIS_AUTH_FAILED: 502,
  WEBUNTIS_UNAVAILABLE: 502,
  WEBUNTIS_PERMISSION_DENIED: 403,
  WEBUNTIS_INVALID_REQUEST: 400,
  WEBUNTIS_HOST_NOT_ALLOWED: 400,
};

export class WebUntisError extends Error {
  readonly code: WebUntisErrorCode;
  readonly status: number;
  /** Whether a queued write may be retried without human intervention. */
  readonly retryable: boolean;

  constructor(code: WebUntisErrorCode, message: string, options: { retryable?: boolean; cause?: unknown } = {}) {
    super(message, { cause: options.cause });
    this.name = 'WebUntisError';
    this.code = code;
    this.status = STATUS_BY_CODE[code];
    this.retryable =
      options.retryable ?? (code === 'WEBUNTIS_UNAVAILABLE' || code === 'WEBUNTIS_AUTH_FAILED');
  }
}

/** True when a caught value is a WebUntisError with a stable code. */
export function isWebUntisError(err: unknown): err is WebUntisError {
  return err instanceof WebUntisError;
}

/** Map any caught value onto the contract, preserving a known code. */
export function asWebUntisError(err: unknown, fallbackCode: WebUntisErrorCode = 'WEBUNTIS_UNAVAILABLE'): WebUntisError {
  if (isWebUntisError(err)) return err;
  const message = err instanceof Error ? err.message : String(err);
  return new WebUntisError(fallbackCode, message, { cause: err });
}
