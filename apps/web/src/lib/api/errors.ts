import type { ApiErrorBody, ApiErrorCode } from "@engora/types";

export type ClientErrorCode = ApiErrorCode | "NETWORK_ERROR" | "INVALID_RESPONSE";

/** Every failed API call surfaces as an ApiError; UI branches on `code`, never on `message`. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: ClientErrorCode;
  readonly details: ApiErrorBody["details"];
  readonly requestId: string | undefined;

  constructor(
    status: number,
    body: { code: ClientErrorCode; message: string } & Partial<Omit<ApiErrorBody, "code" | "message">>,
  ) {
    super(body.message);
    this.name = "ApiError";
    this.status = status;
    this.code = body.code;
    this.details = body.details;
    this.requestId = body.request_id;
  }

  /** Field-level validation messages keyed by API field name. */
  get fieldErrors(): Record<string, string> {
    return this.details?.fields ?? {};
  }

  static network(): ApiError {
    return new ApiError(0, {
      code: "NETWORK_ERROR",
      message: "Unable to reach Engora. Check your connection and try again.",
    });
  }

  static invalidResponse(status: number): ApiError {
    return new ApiError(status, {
      code: "INVALID_RESPONSE",
      message: "Unexpected response from the server.",
    });
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

/** A user-presentable message for any thrown value. */
export function errorMessage(error: unknown): string {
  if (isApiError(error)) return error.message;
  return "Something went wrong. Please try again.";
}
