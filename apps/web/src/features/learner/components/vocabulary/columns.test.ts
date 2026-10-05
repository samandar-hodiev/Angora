import { describe, expect, it } from "vitest";

import { DEFAULT_COLUMNS, moved, shown, toggled } from "./columns";

describe("lexicon columns", () => {
  it("moves a language within bounds", () => {
    expect(moved(DEFAULT_COLUMNS, "uz", -1).order).toEqual(["uz", "en", "ru"]);
    expect(moved(DEFAULT_COLUMNS, "en", -1)).toBe(DEFAULT_COLUMNS);
    expect(moved(DEFAULT_COLUMNS, "ru", 1)).toBe(DEFAULT_COLUMNS);
  });

  it("hides one language at most, so two always show", () => {
    const oneHidden = toggled(DEFAULT_COLUMNS, "ru");
    expect(shown(oneHidden)).toEqual(["en", "uz"]);
    expect(toggled(oneHidden, "uz")).toBe(oneHidden);
    expect(shown(toggled(oneHidden, "ru"))).toEqual(["en", "uz", "ru"]);
  });
});
