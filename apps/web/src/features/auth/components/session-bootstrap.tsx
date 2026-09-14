"use client";

import { useEffect } from "react";

import { useSession } from "../hooks";
import { refreshSession, sessionStore } from "../session";

const SESSION_HINT = "engora_session=";
const REFRESH_MARGIN_MS = 60_000;

function hasSessionHint(): boolean {
  return document.cookie.split("; ").some((c) => c.startsWith(SESSION_HINT));
}

/**
 * Restores the session on page load (via the httpOnly refresh cookie) and renews the
 * short-lived access token shortly before it expires.
 */
export function SessionBootstrap() {
  const { status, expiresAt } = useSession();

  useEffect(() => {
    if (sessionStore.getState().status !== "loading") return;
    if (hasSessionHint()) {
      void refreshSession();
    } else {
      sessionStore.clear();
    }
  }, []);

  useEffect(() => {
    if (status !== "authenticated" || !expiresAt) return;
    const delay = Math.max(expiresAt - Date.now() - REFRESH_MARGIN_MS, 5_000);
    const timer = window.setTimeout(() => void refreshSession(), delay);
    return () => window.clearTimeout(timer);
  }, [status, expiresAt]);

  return null;
}
