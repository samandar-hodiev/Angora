import { refreshSession, sessionStore } from "@/features/auth/session";
import { API_VERSION, env } from "@/lib/env";

import { createApiClient } from "./client";

/**
 * The single API client instance for the web app. Feature `api.ts` modules use it;
 * components and pages never call fetch directly.
 */
export const apiClient = createApiClient({
  baseUrl: env.apiUrl,
  version: API_VERSION,
  getAccessToken: () => sessionStore.getState().accessToken,
  refreshAccessToken: refreshSession,
  onUnauthorized: () => sessionStore.clear(),
});

export { ApiError, errorMessage, isApiError } from "./errors";
