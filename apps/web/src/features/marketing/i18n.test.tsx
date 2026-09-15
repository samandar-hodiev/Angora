import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { I18nProvider, useI18n } from "./i18n";

function Probe() {
  const { t, locale, setLocale } = useI18n();
  return (
    <div>
      <p data-testid="cta">{t.hero.primaryCta}</p>
      <p data-testid="locale">{locale}</p>
      <button onClick={() => setLocale("uz")}>uz</button>
      <button onClick={() => setLocale("ru")}>ru</button>
    </div>
  );
}

describe("I18nProvider", () => {
  afterEach(() => localStorage.clear());

  it("defaults to English", () => {
    render(
      <I18nProvider>
        <Probe />
      </I18nProvider>,
    );
    expect(screen.getByTestId("cta")).toHaveTextContent("Start learning");
    expect(document.documentElement.lang).toBe("en");
  });

  it("switches language, updates <html lang> and persists the choice", () => {
    render(
      <I18nProvider>
        <Probe />
      </I18nProvider>,
    );
    act(() => screen.getByText("uz").click());
    expect(screen.getByTestId("cta")).toHaveTextContent("O‘rganishni boshlash");
    expect(document.documentElement.lang).toBe("uz");
    expect(localStorage.getItem("engora-locale")).toBe("uz");

    act(() => screen.getByText("ru").click());
    expect(screen.getByTestId("cta")).toHaveTextContent("Начать обучение");
  });

  it("restores a stored language", () => {
    localStorage.setItem("engora-locale", "ru");
    render(
      <I18nProvider>
        <Probe />
      </I18nProvider>,
    );
    expect(screen.getByTestId("locale")).toHaveTextContent("ru");
  });
});
