import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ApiError } from "@/lib/api/errors";

import { AIFailure } from "./ai-panels";

/**
 * A plan refusal is not a fault.
 *
 * The AI routes became entitlement-gated, which means the most common "failure" a free
 * learner sees is not a broken service — it is the paywall. Showing them "temporarily
 * unavailable" would be untrue and would hide the only thing they can act on.
 */
describe("AIFailure", () => {
  it("offers an upgrade when the feature is not on the learner's plan", () => {
    const error = new ApiError(403, { code: "ENTITLEMENT_REQUIRED", message: "Your plan does not include this feature" });

    render(<AIFailure error={error} what="The AI tutor" />);

    expect(screen.getByText(/part of a paid plan/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /see plans/i })).toHaveAttribute("href", "/app/subscription");
    expect(screen.queryByText(/temporarily unavailable/i)).not.toBeInTheDocument();
  });

  it("says the allowance is spent, and when it returns, once the budget runs out", () => {
    const error = new ApiError(429, {
      code: "USAGE_LIMIT_REACHED",
      message: "You have reached your plan's limit",
      details: { resets_at: "2026-10-01T00:00:00Z" },
    });

    render(<AIFailure error={error} what="AI explanations" />);

    expect(screen.getByText(/used all of your ai explanations this month/i)).toBeInTheDocument();
    expect(screen.getByText(/allowance returns on/i)).toBeInTheDocument();
  });

  it("still reports a real failure as a failure", () => {
    render(<AIFailure error={ApiError.network()} what="The AI explanation" />);

    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /see plans/i })).not.toBeInTheDocument();
  });
});
