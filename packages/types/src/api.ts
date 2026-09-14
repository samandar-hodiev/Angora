/**
 * The response envelope returned by every Engora API endpoint (see docs/api/README.md).
 * These types mirror apps/api/pkg/httpx and must change together with it.
 */

export type ApiErrorCode =
  | "VALIDATION_ERROR"
  | "BAD_REQUEST"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "ENTITLEMENT_REQUIRED"
  | "USAGE_LIMIT_REACHED"
  | "NOT_FOUND"
  | "CONFLICT"
  | "PAYLOAD_TOO_LARGE"
  | "UNSUPPORTED_MEDIA_TYPE"
  | "RATE_LIMITED"
  | "NOT_IMPLEMENTED"
  | "SERVICE_UNAVAILABLE"
  | "INTERNAL_ERROR";

export interface ApiErrorBody {
  code: ApiErrorCode;
  message: string;
  details?: {
    /** Field-level validation messages keyed by JSON field name. */
    fields?: Record<string, string>;
    [key: string]: unknown;
  };
  request_id?: string;
}

export interface PageMeta {
  page?: number;
  page_size?: number;
  total: number;
}

export interface ApiSuccess<T> {
  success: true;
  data: T;
  meta?: PageMeta;
}

export interface ApiFailure {
  success: false;
  error: ApiErrorBody;
  data?: unknown;
}

export type ApiEnvelope<T> = ApiSuccess<T> | ApiFailure;

export interface Paginated<T> {
  items: T[];
  meta: PageMeta;
}

/** ISO-8601 timestamp string as serialized by the API. */
export type Timestamp = string;

/** UUID string. */
export type UUID = string;
