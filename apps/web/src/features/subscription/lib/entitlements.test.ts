import type { Entitlements, SubscriptionPlan } from "@engora/types";
import { describe, expect, it } from "vitest";

import { describeEntitlement, formatPlanPrice, hasFeature, usagePercent } from "./entitlements";

const entitlements: Entitlements = {
  plan_code: "free",
  plan_name: "Free",
  status: "free",
  features: ["speaking.practice", "writing.practice"],
  limits: {
    "speaking.evaluations": { label: "AI speaking evaluations", limit: 3, used: 2, remaining: 1, period: "day", resets_at: null },
  },
};

describe("entitlements", () => {
  it("checks features by key, never by plan code", () => {
    expect(hasFeature(entitlements, "speaking.practice")).toBe(true);
    expect(hasFeature(entitlements, "ai_coach.chat")).toBe(false);
    expect(hasFeature(undefined, "speaking.practice")).toBe(false);
  });

  it("computes usage percent and handles unlimited limits", () => {
    expect(usagePercent(entitlements.limits["speaking.evaluations"]!)).toBe(67);
    expect(usagePercent({ label: "", limit: null, used: 40, remaining: null, period: "day", resets_at: null })).toBe(0);
  });

  it("describes plan entitlements from API data", () => {
    expect(describeEntitlement({ key: "k", kind: "limit", description: "AI speaking evaluations", limit: 3, period: "day" })).toBe(
      "3 ai speaking evaluations per day",
    );
    expect(describeEntitlement({ key: "k", kind: "limit", description: "AI coach messages", limit: null, period: "day" })).toBe(
      "Unlimited ai coach messages",
    );
    expect(describeEntitlement({ key: "k", kind: "feature", description: "IELTS preparation mode", limit: null, period: null })).toBe(
      "IELTS preparation mode",
    );
  });

  it("formats prices from the plan", () => {
    const plan = { price_cents: 999, currency: "USD", billing_interval: "month" } as SubscriptionPlan;
    expect(formatPlanPrice(plan, "en-US")).toBe("$9.99 / month");
    expect(formatPlanPrice({ ...plan, price_cents: 0 }, "en-US")).toBe("Free");
  });
});
