/**
 * errors.ts — Shared error types for V2 API responses.
 */

/** Standard error body returned by hub-api controllers. */
export type ApiErrorResponse = {
  error: string;
};

/** A typed API error that includes the HTTP status code. */
export type ApiError = Error & {
  status: number;
};

export function isApiError(error: unknown): error is ApiError {
  return error instanceof Error && "status" in error;
}
