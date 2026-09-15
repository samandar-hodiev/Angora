import type { ApiEnvelope, User, WebSession } from "@engora/types";

import { ApiError } from "@/lib/api/errors";

/**
 * Web session management.
 *
 * - The access token lives only in memory (never localStorage), so XSS cannot read a
 *   long-lived credential from storage.
 * - The refresh token lives in an httpOnly, SameSite=Strict cookie set by this app's own
 *   route handler (src/app/api/session/[action]/route.ts). Browser JS never sees it.
 * - The Go API stays platform-agnostic: it returns both tokens in JSON; mobile apps keep
 *   them in the device keychain instead.
 */

export type SessionStatus = "loading" | "authenticated" | "anonymous";

export interface SessionState {
  status: SessionStatus;
  accessToken: string | null;
  expiresAt: number | null;
  user: User | null;
}

type Listener = () => void;

function createSessionStore() {
  let state: SessionState = { status: "loading", accessToken: null, expiresAt: null, user: null };
  const listeners = new Set<Listener>();

  const emit = () => listeners.forEach((l) => l());

  return {
    getState: () => state,
    subscribe(listener: Listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    setSession(session: WebSession) {
      state = {
        status: "authenticated",
        accessToken: session.access_token,
        expiresAt: Date.parse(session.access_token_expires_at),
        user: session.user,
      };
      emit();
    },
    clear() {
      if (state.status === "anonymous" && state.accessToken === null) return;
      state = { status: "anonymous", accessToken: null, expiresAt: null, user: null };
      emit();
    },
  };
}

export const sessionStore = createSessionStore();

/**
 * Where to land after a sign-in completes. Set just before the session is stored, so the
 * GuestGuard (which reacts to the new session) and the form agree on one destination —
 * e.g. onboarding for brand-new accounts instead of the dashboard.
 */
let pendingRedirect: string | null = null;

export function takePendingRedirect(): string | null {
  const next = pendingRedirect;
  pendingRedirect = null;
  return next;
}

function completeSignIn(session: WebSession, landing: string) {
  pendingRedirect = landing;
  sessionStore.setSession(session);
  return session;
}

const SESSION_ROUTE = "/api/session";

async function callSessionRoute(
  action: "login" | "register" | "google" | "email-verify" | "refresh" | "logout",
  body?: unknown,
) {
  let response: Response;
  try {
    response = await fetch(`${SESSION_ROUTE}/${action}`, {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json",
        // Custom header: a cross-site form cannot set it, which blocks CSRF on these routes.
        "X-Engora-Session": "1",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw ApiError.network();
  }
  if (response.status === 204) return null;

  let envelope: ApiEnvelope<WebSession>;
  try {
    envelope = (await response.json()) as ApiEnvelope<WebSession>;
  } catch {
    throw ApiError.invalidResponse(response.status);
  }
  if (!envelope.success) throw new ApiError(response.status, envelope.error);
  return envelope.data;
}

export const ONBOARDING_PATH = "/onboarding";
export const SETUP_PROFILE_PATH = "/setup-profile";
export const DEFAULT_LANDING_PATH = "/app/dashboard";

export async function login(
  input: { email: string; password: string },
  landing: string = DEFAULT_LANDING_PATH,
): Promise<WebSession> {
  const session = await callSessionRoute("login", input);
  return completeSignIn(session!, landing);
}

export async function register(input: {
  display_name: string;
  email: string;
  password: string;
  timezone?: string;
}): Promise<WebSession> {
  const session = await callSessionRoute("register", input);
  // New learners set up their goal, level and plan before seeing the dashboard.
  return completeSignIn(session!, ONBOARDING_PATH);
}

/** Exchanges a Google ID token (from Google Identity Services) for an Engora session. */
export async function loginWithGoogle(
  input: { id_token: string; timezone?: string },
  landing: string = DEFAULT_LANDING_PATH,
): Promise<WebSession> {
  const session = await callSessionRoute("google", input);
  // New accounts complete their profile first; returning learners are routed by the
  // journey guard (dashboard, or wherever they stopped).
  return completeSignIn(session!, session!.is_new_user ? SETUP_PROFILE_PATH : landing);
}

/** Verifies an emailed sign-up code on the server; creates the account and signs in. */
export async function verifyEmailCode(input: { email: string; code: string; timezone?: string }): Promise<WebSession> {
  const session = await callSessionRoute("email-verify", input);
  return completeSignIn(session!, SETUP_PROFILE_PATH);
}

export function browserTimezone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return undefined;
  }
}

export async function logout(): Promise<void> {
  try {
    await callSessionRoute("logout");
  } finally {
    sessionStore.clear();
  }
}

let inflightRefresh: Promise<string | null> | null = null;

/**
 * Renews the access token using the refresh cookie. Concurrent callers share one request,
 * because the API rotates refresh tokens and treats parallel reuse as token theft.
 */
export function refreshSession(): Promise<string | null> {
  inflightRefresh ??= callSessionRoute("refresh")
    .then((session) => {
      if (!session) {
        sessionStore.clear();
        return null;
      }
      sessionStore.setSession(session);
      return session.access_token;
    })
    .catch(() => {
      sessionStore.clear();
      return null;
    })
    .finally(() => {
      inflightRefresh = null;
    });
  return inflightRefresh;
}
