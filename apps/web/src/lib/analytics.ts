import { apiClient } from "@/lib/api";

/**
 * Product analytics, provider-neutral.
 *
 * State changes (onboarding_completed, placement_completed, ...) are recorded by the API
 * where they happen, so every client reports them identically. The web only sends UI events
 * the server cannot see. The default provider forwards them to POST /api/v1/analytics/events;
 * swap it with setAnalyticsProvider() to use a vendor SDK without touching call sites.
 */

export const CLIENT_EVENTS = [
  "signup_started",
  "signup_google_clicked",
  "signup_email_clicked",
  "login_started",
  "login_completed",
  "forgot_password_started",
  "password_reset_completed",
  "profile_setup_started",
  "assessment_result_viewed",
  "first_learning_session_started",
] as const;

export type ClientEvent = (typeof CLIENT_EVENTS)[number];
export type EventProperties = Record<string, string | number | boolean | null>;

export interface AnalyticsProvider {
  track(name: ClientEvent, properties?: EventProperties): void;
}

const ANONYMOUS_ID_KEY = "engora-anonymous-id";

function anonymousId(): string {
  try {
    let id = localStorage.getItem(ANONYMOUS_ID_KEY);
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem(ANONYMOUS_ID_KEY, id);
    }
    return id;
  } catch {
    return "";
  }
}

interface QueuedEvent {
  name: ClientEvent;
  properties: EventProperties;
  occurred_at: string;
  anonymous_id: string;
}

/** Batches events and sends them to the Engora API. Failures are dropped silently. */
export class ApiAnalyticsProvider implements AnalyticsProvider {
  private queue: QueuedEvent[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;

  track(name: ClientEvent, properties: EventProperties = {}) {
    this.queue.push({ name, properties, occurred_at: new Date().toISOString(), anonymous_id: anonymousId() });
    this.timer ??= setTimeout(() => this.flush(), 800);
  }

  flush() {
    this.timer = null;
    const events = this.queue.splice(0, 20);
    if (events.length === 0) return;
    void apiClient.post("/analytics/events", { events }).catch(() => undefined);
    if (this.queue.length > 0) this.timer = setTimeout(() => this.flush(), 800);
  }
}

const noop: AnalyticsProvider = { track: () => undefined };

let provider: AnalyticsProvider = typeof window === "undefined" ? noop : new ApiAnalyticsProvider();

export function setAnalyticsProvider(next: AnalyticsProvider) {
  provider = next;
}

export function track(name: ClientEvent, properties?: EventProperties) {
  try {
    provider.track(name, properties);
  } catch {
    // Analytics must never break the product.
  }
}
