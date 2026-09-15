import { describe, expect, it } from "vitest";

import { detectCountry, nationalPart, toE164 } from "./phone";

describe("phone numbers", () => {
  it("detects the default country from locales", () => {
    expect(detectCountry(["uz-Latn-UZ"])).toBe("UZ");
    expect(detectCountry(["en-GB", "uz"])).toBe("GB");
    expect(detectCountry(["xx-invalid"])).toBe("UZ");
    expect(detectCountry([])).toBe("UZ");
  });

  it("builds E.164 numbers", () => {
    expect(toE164("UZ", "90 123 45 67")).toBe("+998901234567");
    expect(toE164("GB", "07911 123456")).toBe("+447911123456");
    expect(toE164("UZ", "+1 (415) 555-0100")).toBe("+14155550100");
    expect(toE164("UZ", "12")).toBeNull();
    expect(toE164("UZ", "")).toBeNull();
  });

  it("splits a stored number for editing", () => {
    expect(nationalPart("UZ", "+998901234567")).toBe("901234567");
    expect(nationalPart("GB", "+998901234567")).toBe("+998901234567");
    expect(nationalPart("UZ", null)).toBe("");
  });
});
