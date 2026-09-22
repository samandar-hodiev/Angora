import type { ApiEnvelope, AuthSession } from "@engora/types";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Web-only session bridge (a thin backend-for-frontend).
 *
 * Proxies login/register/google/refresh/logout to the Go API and keeps the refresh token in an
 * httpOnly cookie scoped to this route, so browser JavaScript never handles it.
 * The Go API itself has no web-specific logic.
 */

const REFRESH_COOKIE = "engora_rt";
const COOKIE_PATH = "/api/session";
/**
 * Non-secret hint readable by client JS. It only says "a session probably exists", letting
 * anonymous visitors skip a pointless refresh request on page load.
 */
export const SESSION_HINT_COOKIE = "engora_session";

const upstreamPaths = {
  login: "/auth/login",
  register: "/auth/register",
  google: "/auth/google",
  "email-verify": "/auth/email/verify",
  // The Owner Console's own door. It ends in a session like any other, so the refresh token
  // has to land in the same httpOnly cookie rather than in console JavaScript.
  "owner-verify": "/auth/owner/verify",
  refresh: "/auth/refresh",
  logout: "/auth/logout",
} as const;

type Action = keyof typeof upstreamPaths;

function isAction(value: string): value is Action {
  return Object.hasOwn(upstreamPaths, value);
}

function errorResponse(status: number, code: string, message: string) {
  return NextResponse.json({ success: false, error: { code, message } }, { status });
}

function clearRefreshCookie(response: NextResponse) {
  response.cookies.set(REFRESH_COOKIE, "", { httpOnly: true, path: COOKIE_PATH, maxAge: 0 });
  response.cookies.set(SESSION_HINT_COOKIE, "", { path: "/", maxAge: 0 });
  return response;
}

export async function POST(request: NextRequest, context: { params: Promise<{ action: string }> }) {
  const { action } = await context.params;
  if (!isAction(action)) {
    return errorResponse(404, "NOT_FOUND", "Route not found");
  }
  if (request.headers.get("x-engora-session") !== "1") {
    return errorResponse(403, "FORBIDDEN", "Missing session header");
  }

  let payload: unknown;
  if (action === "login" || action === "register" || action === "google" || action === "email-verify" || action === "owner-verify") {
    payload = await request.json().catch(() => null);
    if (!payload || typeof payload !== "object") {
      return errorResponse(400, "BAD_REQUEST", "Request body is not valid JSON");
    }
  } else {
    const refreshToken = request.cookies.get(REFRESH_COOKIE)?.value;
    if (!refreshToken) {
      return action === "logout"
        ? clearRefreshCookie(new NextResponse(null, { status: 204 }))
        : errorResponse(401, "UNAUTHORIZED", "No active session");
    }
    payload = { refresh_token: refreshToken };
  }

  const apiBase = (process.env.API_INTERNAL_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000").replace(
    /\/+$/,
    "",
  );
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Client-Platform": "web",
    "User-Agent": request.headers.get("user-agent") ?? "engora-web",
  };
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) headers["X-Forwarded-For"] = forwardedFor;

  let upstream: Response;
  try {
    upstream = await fetch(`${apiBase}/api/v1${upstreamPaths[action]}`, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      cache: "no-store",
    });
  } catch {
    return errorResponse(503, "SERVICE_UNAVAILABLE", "The Engora API is unavailable");
  }

  if (action === "logout") {
    return clearRefreshCookie(new NextResponse(null, { status: 204 }));
  }

  const envelope = (await upstream.json().catch(() => null)) as ApiEnvelope<AuthSession> | null;
  if (!envelope || !upstream.ok || !envelope.success) {
    const response = envelope
      ? NextResponse.json(envelope, { status: upstream.status })
      : errorResponse(502, "INVALID_RESPONSE", "Unexpected response from the API");
    return action === "refresh" && upstream.status === 401 ? clearRefreshCookie(response) : response;
  }

  const { refresh_token, refresh_token_expires_at, ...session } = envelope.data;
  const response = NextResponse.json({ success: true, data: session }, { status: upstream.status });
  response.cookies.set(REFRESH_COOKIE, refresh_token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: COOKIE_PATH,
    expires: new Date(refresh_token_expires_at),
  });
  response.cookies.set(SESSION_HINT_COOKIE, "1", {
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: new Date(refresh_token_expires_at),
  });
  return response;
}
