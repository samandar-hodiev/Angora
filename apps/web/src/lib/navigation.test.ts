import { describe, expect, it } from "vitest";

import { safeRedirect } from "./navigation";

describe("safeRedirect", () => {
  it("keeps same-origin app paths", () => {
    expect(safeRedirect("/app/profile?tab=goals")).toBe("/app/profile?tab=goals");
  });

  it.each([null, undefined, "", "https://evil.example", "//evil.example", "/\\evil.example", "/api/session/logout"])(
    "falls back for %s",
    (target) => {
      expect(safeRedirect(target)).toBe("/app/dashboard");
    },
  );
});
