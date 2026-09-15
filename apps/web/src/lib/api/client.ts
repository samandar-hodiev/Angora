import type { ApiEnvelope, PageMeta } from "@engora/types";

import { ApiError } from "./errors";

type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
type QueryValue = string | number | boolean | null | undefined;

export interface RequestOptions {
  method?: HttpMethod;
  body?: unknown;
  query?: Record<string, QueryValue>;
  /** Send the access token (default true). Public endpoints can pass false. */
  auth?: boolean;
  /** Override the API version for a single call during a v1 → v2 migration. */
  version?: string;
  signal?: AbortSignal;
  headers?: Record<string, string>;
}

export interface ApiResult<T> {
  data: T;
  meta?: PageMeta;
}

export interface ApiClientConfig {
  /** API origin without version, e.g. https://api.engora.com */
  baseUrl: string;
  version: string;
  getAccessToken: () => string | null;
  /** Obtain a fresh access token, or null when the session cannot be renewed. */
  refreshAccessToken: () => Promise<string | null>;
  onUnauthorized?: () => void;
  fetch?: typeof fetch;
}

/**
 * Centralized API client. Responsibilities:
 *  - builds versioned URLs (/api/{version}/...)
 *  - attaches the bearer token and client platform header
 *  - unwraps the { success, data, error } envelope
 *  - converts every failure into an ApiError
 *  - on 401 refreshes the session once and retries the request
 */
export function createApiClient(config: ApiClientConfig) {
  const doFetch = config.fetch ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  const base = config.baseUrl.replace(/\/+$/, "");

  function buildUrl(path: string, version: string, query?: Record<string, QueryValue>): string {
    const url = new URL(`${base}/api/${version}${path.startsWith("/") ? path : `/${path}`}`);
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined && value !== null && value !== "") {
        url.searchParams.set(key, String(value));
      }
    }
    return url.toString();
  }

  async function send(path: string, options: RequestOptions, token: string | null): Promise<Response> {
    const headers: Record<string, string> = {
      Accept: "application/json",
      "X-Client-Platform": "web",
      ...options.headers,
    };
    // FormData (file uploads) sets its own multipart boundary header.
    const isForm = typeof FormData !== "undefined" && options.body instanceof FormData;
    if (options.body !== undefined && !isForm) headers["Content-Type"] = "application/json";
    if (token) headers.Authorization = `Bearer ${token}`;

    try {
      return await doFetch(buildUrl(path, options.version ?? config.version, options.query), {
        method: options.method ?? "GET",
        headers,
        body: options.body === undefined ? undefined : isForm ? (options.body as FormData) : JSON.stringify(options.body),
        signal: options.signal,
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") throw error;
      throw ApiError.network();
    }
  }

  async function fetchWithRefresh(path: string, options: RequestOptions): Promise<Response> {
    const useAuth = options.auth !== false;
    let response = await send(path, options, useAuth ? config.getAccessToken() : null);

    if (response.status === 401 && useAuth) {
      const refreshed = await config.refreshAccessToken();
      if (refreshed) {
        response = await send(path, options, refreshed);
      }
      if (response.status === 401) {
        config.onUnauthorized?.();
      }
    }
    return response;
  }

  async function errorFrom(response: Response): Promise<ApiError> {
    try {
      const envelope = (await response.json()) as ApiEnvelope<unknown>;
      if (envelope && typeof envelope === "object" && "success" in envelope && !envelope.success) {
        return new ApiError(response.status, envelope.error);
      }
    } catch {
      // fall through
    }
    return ApiError.invalidResponse(response.status);
  }

  /** Binary downloads (e.g. listening audio) with the same auth and refresh behaviour. */
  async function blob(path: string, options: Omit<RequestOptions, "method" | "body"> = {}): Promise<Blob> {
    const response = await fetchWithRefresh(path, { ...options, method: "GET" });
    if (!response.ok) throw await errorFrom(response);
    return response.blob();
  }

  async function request<T>(path: string, options: RequestOptions = {}): Promise<ApiResult<T>> {
    const response = await fetchWithRefresh(path, options);

    if (response.status === 204) {
      return { data: undefined as T };
    }

    let envelope: ApiEnvelope<T>;
    try {
      envelope = (await response.json()) as ApiEnvelope<T>;
    } catch {
      throw ApiError.invalidResponse(response.status);
    }

    if (!envelope || typeof envelope !== "object" || !("success" in envelope)) {
      throw ApiError.invalidResponse(response.status);
    }
    if (!envelope.success) {
      throw new ApiError(response.status, envelope.error);
    }
    return { data: envelope.data, meta: envelope.meta };
  }

  return {
    request,
    blob,
    postForm: <T>(path: string, form: FormData, options?: Omit<RequestOptions, "method" | "body">) =>
      request<T>(path, { ...options, method: "POST", body: form }).then((r) => r.data),
    get: <T>(path: string, options?: Omit<RequestOptions, "method" | "body">) =>
      request<T>(path, { ...options, method: "GET" }).then((r) => r.data),
    getPage: <T>(path: string, options?: Omit<RequestOptions, "method" | "body">) =>
      request<T[]>(path, { ...options, method: "GET" }).then((r) => ({
        items: r.data,
        meta: r.meta ?? { total: r.data.length },
      })),
    post: <T>(path: string, body?: unknown, options?: Omit<RequestOptions, "method" | "body">) =>
      request<T>(path, { ...options, method: "POST", body }).then((r) => r.data),
    patch: <T>(path: string, body?: unknown, options?: Omit<RequestOptions, "method" | "body">) =>
      request<T>(path, { ...options, method: "PATCH", body }).then((r) => r.data),
    put: <T>(path: string, body?: unknown, options?: Omit<RequestOptions, "method" | "body">) =>
      request<T>(path, { ...options, method: "PUT", body }).then((r) => r.data),
    delete: <T>(path: string, options?: Omit<RequestOptions, "method" | "body">) =>
      request<T>(path, { ...options, method: "DELETE" }).then((r) => r.data),
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
