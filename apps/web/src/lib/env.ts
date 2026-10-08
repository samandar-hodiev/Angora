import { z } from "zod";

/**
 * Public (browser-visible) configuration. NEXT_PUBLIC_* values are inlined at build time,
 * so they must be referenced literally here.
 */
const schema = z.object({
  apiUrl: z.url(),
  /** Accounts (emails, comma-separated) that may use coaches still in testing. */
  coachTesters: z.array(z.string()),
});

export const env = schema.parse({
  apiUrl: process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000",
  coachTesters: (process.env.NEXT_PUBLIC_COACH_TESTERS ?? "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean),
});

/** The API version this web build speaks. Bump per feature area when adopting /api/v2. */
export const API_VERSION = "v1";
