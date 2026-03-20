export type KalshiErrorCode =
  | "network"
  | "http"
  | "rate_limit"
  | "parse"
  | "unknown";

export class KalshiError extends Error {
  readonly code: KalshiErrorCode;
  readonly status?: number;
  readonly body?: string;

  constructor(
    message: string,
    code: KalshiErrorCode,
    opts?: { status?: number; body?: string; cause?: unknown }
  ) {
    super(message, { cause: opts?.cause });
    this.name = "KalshiError";
    this.code = code;
    this.status = opts?.status;
    this.body = opts?.body;
  }
}

export type Ok<T> = { ok: true; data: T };
export type Err = { ok: false; error: KalshiError };
export type Result<T> = Ok<T> | Err;

export function ok<T>(data: T): Ok<T> {
  return { ok: true, data };
}

export function err(error: KalshiError): Err {
  return { ok: false, error };
}
