import { describe, expect, it } from "vitest";

import { loginSchema, profileUpdateSchema, registerSchema, toRegisterPayload } from "./index";

function fieldErrors(result: { success: boolean; error?: { issues: { path: PropertyKey[]; message: string }[] } }) {
  return Object.fromEntries((result.error?.issues ?? []).map((i) => [i.path.join("."), i.message]));
}

describe("loginSchema", () => {
  it("trims email and accepts valid credentials", () => {
    const parsed = loginSchema.parse({ email: "  learner@example.com ", password: "x" });
    expect(parsed.email).toBe("learner@example.com");
  });

  it("rejects invalid email and empty password", () => {
    const errors = fieldErrors(loginSchema.safeParse({ email: "nope", password: "" }));
    expect(errors.email).toBe("Enter a valid email address");
    expect(errors.password).toBe("Password is required");
  });
});

describe("registerSchema", () => {
  const valid = {
    display_name: "Aziza",
    email: "aziza@example.com",
    password: "long-enough",
    confirm_password: "long-enough",
  };

  it("accepts a valid registration and strips confirm_password from the payload", () => {
    const parsed = registerSchema.parse(valid);
    expect(toRegisterPayload(parsed)).not.toHaveProperty("confirm_password");
  });

  it("enforces the same password length limits as the API", () => {
    const errors = fieldErrors(registerSchema.safeParse({ ...valid, password: "short", confirm_password: "short" }));
    expect(errors.password).toMatch(/at least 8/);
  });

  it("requires matching passwords", () => {
    const errors = fieldErrors(registerSchema.safeParse({ ...valid, confirm_password: "different" }));
    expect(errors.confirm_password).toBe("Passwords do not match");
  });
});

describe("profileUpdateSchema", () => {
  it("allows partial updates", () => {
    expect(profileUpdateSchema.safeParse({ daily_goal_minutes: 20 }).success).toBe(true);
  });

  it("bounds the daily goal", () => {
    const errors = fieldErrors(profileUpdateSchema.safeParse({ daily_goal_minutes: 1 }));
    expect(errors.daily_goal_minutes).toMatch(/at least 5/);
  });
});
