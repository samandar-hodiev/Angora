import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type * as ApiModule from "@/lib/api";

/**
 * Adding a word by hand: the owner types the term and AI fills in the rest — translation,
 * level, part of speech, pronunciation, explanation. Filled fields are marked; a field the
 * owner typed into first is theirs and is not overwritten.
 */

const api = vi.hoisted(() => ({ post: vi.fn() }));
vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof ApiModule>();
  return { ...actual, apiClient: { ...actual.apiClient, post: api.post } };
});

import { WordDialog } from "./vocabulary-view";

const hello = {
  term: "hello",
  part_of_speech: "exclamation",
  level: "A1",
  level_source: "ai_checked",
  pronunciation_ipa: "/həˈləʊ/",
  translations: { uz: "salom", ru: "привет", ru_pron: "privyét", def_uz: "salomlashish", def_ru: "приветствие" },
  level_content: { A1: { definition: "Something you say when you meet someone.", examples: ["Hello, how are you?"] } },
  tags: ["greetings"],
};

function renderDialog() {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <WordDialog kind="word" word={null} onClose={() => {}} onSaved={() => {}} />
    </QueryClientProvider>,
  );
}

describe("WordDialog — AI fills in a typed word", () => {
  it("fills every field from the term, and leaves alone what the owner typed", async () => {
    api.post.mockResolvedValue(hello);
    const user = userEvent.setup();
    renderDialog();
    await user.type(screen.getByLabelText("Русский"), "здравствуйте");
    await user.type(screen.getByRole("textbox", { name: "Word" }), "hello");
    await user.tab();

    await waitFor(() => expect(screen.getByLabelText(/O'zbekcha/)).toHaveValue("salom"));
    expect(api.post).toHaveBeenCalledWith("/admin/vocabulary/suggest", { term: "hello", kind: "word" });
    expect(screen.getByRole("combobox", { name: /^Level/ })).toHaveValue("A1");
    expect(screen.getByRole("combobox", { name: /^Part of speech/ })).toHaveValue("exclamation");
    expect(screen.getByLabelText(/Pronunciation/)).toHaveValue("/həˈləʊ/");
    expect(screen.getByLabelText(/A1 definition/)).toHaveValue("Something you say when you meet someone.");
    expect(screen.getByLabelText("Русский")).toHaveValue("здравствуйте");
    expect(screen.getByText(/Filled in and checked by AI/)).toBeInTheDocument();
    expect(screen.getByLabelText(/O'zbekcha/).className).toContain("border-success");
  });

  it("says why a term was refused", async () => {
    const { ApiError } = await import("@/lib/api");
    api.post.mockRejectedValue(
      new ApiError(422, {
        code: "VALIDATION_ERROR",
        message: "Invalid request",
        details: { fields: { term: "Vocabulary holds single words — add a combination on the Phrases or Collocations page." } },
      } as never),
    );
    const user = userEvent.setup();
    renderDialog();
    await user.type(screen.getByRole("textbox", { name: "Word" }), "bus station");
    await user.tab();
    expect(await screen.findByText(/Vocabulary holds single words/)).toBeInTheDocument();
  });
});
