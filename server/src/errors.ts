/**
 * The error shape from docs/API-CONTRACT.md §7:
 *
 *   { "error": { "code": "books_do_not_balance", "message": "..." } }
 *
 * `code` is what callers branch on (net/client.ts's ApiError.code); `message`
 * is for humans and may change without notice.
 *
 * On a 409, `meta` carries the current SlotMeta -- net/client.ts reads
 * `payload?.meta ?? payload?.current`, so `meta` is the name to use.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly meta?: unknown;

  constructor(status: number, code: string, message: string, meta?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.meta = meta;
  }

  toBody(): { error: { code: string; message: string }; meta?: unknown } {
    return {
      error: { code: this.code, message: this.message },
      ...(this.meta !== undefined ? { meta: this.meta } : {}),
    };
  }
}

export function apiError(status: number, code: string, message: string, meta?: unknown): ApiError {
  return new ApiError(status, code, message, meta);
}
