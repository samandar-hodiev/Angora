import { describe, expect, it, vi } from "vitest";

import { createApiClient, type ApiClientConfig } from "./client";
import { ApiError } from "./errors";

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function setup(overrides: Partial<ApiClientConfig> = {}) {
  const fetchMock = vi.fn<typeof fetch>();
  const client = createApiClient({
    baseUrl: "https://api.engora.test/",
    version: "v1",
    getAccessToken: () => "access-1",
    refreshAccessToken: vi.fn(async () => null),
    fetch: fetchMock,
    ...overrides,
  });
  return { client, fetchMock };
}

describe("apiClient", () => {
  it("builds versioned URLs, sends auth and platform headers and unwraps data", async () => {
    const { client, fetchMock } = setup();
    fetchMock.mockResolvedValueOnce(json(200, { success: true, data: [{ code: "speaking" }] }));

    const data = await client.get<{ code: string }[]>("/learning/skills", { query: { page: 2, empty: "" } });

    expect(data).toEqual([{ code: "speaking" }]);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://api.engora.test/api/v1/learning/skills?page=2");
    const headers = init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer access-1");
    expect(headers["X-Client-Platform"]).toBe("web");
  });

  it("omits the token for public calls and supports per-call versions", async () => {
    const { client, fetchMock } = setup();
    fetchMock.mockResolvedValueOnce(json(200, { success: true, data: {} }));

    await client.get("/health", { auth: false, version: "v2" });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://api.engora.test/api/v2/health");
    expect((init?.headers as Record<string, string>).Authorization).toBeUndefined();
  });

  it("throws ApiError with code and field errors from the envelope", async () => {
    const { client, fetchMock } = setup();
    fetchMock.mockResolvedValueOnce(
      json(422, {
        success: false,
        error: {
          code: "VALIDATION_ERROR",
          message: "Invalid request",
          details: { fields: { email: "must be a valid email address" } },
          request_id: "req-1",
        },
      }),
    );

    const error = await client.post("/auth/register", {}).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    const apiError = error as ApiError;
    expect(apiError.status).toBe(422);
    expect(apiError.code).toBe("VALIDATION_ERROR");
    expect(apiError.fieldErrors.email).toBe("must be a valid email address");
    expect(apiError.requestId).toBe("req-1");
  });

  it("refreshes once on 401 and retries with the new token", async () => {
    const refreshAccessToken = vi.fn(async () => "access-2");
    const { client, fetchMock } = setup({ refreshAccessToken });
    fetchMock
      .mockResolvedValueOnce(json(401, { success: false, error: { code: "UNAUTHORIZED", message: "expired" } }))
      .mockResolvedValueOnce(json(200, { success: true, data: { id: "u1" } }));

    const data = await client.get<{ id: string }>("/users/me");

    expect(data).toEqual({ id: "u1" });
    expect(refreshAccessToken).toHaveBeenCalledTimes(1);
    const retryHeaders = fetchMock.mock.calls[1]![1]?.headers as Record<string, string>;
    expect(retryHeaders.Authorization).toBe("Bearer access-2");
  });

  it("signals logout when the session cannot be refreshed", async () => {
    const onUnauthorized = vi.fn();
    const { client, fetchMock } = setup({ onUnauthorized });
    fetchMock.mockResolvedValueOnce(json(401, { success: false, error: { code: "UNAUTHORIZED", message: "expired" } }));

    await expect(client.get("/users/me")).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("maps network failures and non-envelope responses to ApiError", async () => {
    const { client, fetchMock } = setup();
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await expect(client.get("/x")).rejects.toMatchObject({ code: "NETWORK_ERROR", status: 0 });

    fetchMock.mockResolvedValueOnce(new Response("<html>502 Bad Gateway</html>", { status: 502 }));
    await expect(client.get("/x")).rejects.toMatchObject({ code: "INVALID_RESPONSE", status: 502 });
  });
});
