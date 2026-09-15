import type { EmailChallenge } from "@engora/types";

/**
 * Remembers the last verification challenge for this tab (resend timing survives a refresh).
 * It holds no secret: the code is only in the learner's inbox and checked by the API.
 */
const KEY = "engora-email-challenge";

export function saveChallenge(challenge: EmailChallenge) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(challenge));
  } catch {
    // storage unavailable: the countdown simply starts fresh
  }
}

export function loadChallenge(email: string): EmailChallenge | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const challenge = JSON.parse(raw) as EmailChallenge;
    return challenge.email === email.trim().toLowerCase() ? challenge : null;
  } catch {
    return null;
  }
}

export function clearChallenge() {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}
