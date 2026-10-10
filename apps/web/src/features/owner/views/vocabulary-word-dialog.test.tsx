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

const api = vi.hoisted(() => ({ post: vi.fn(), get: vi.fn() }));
vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof ApiModule>();
  return { ...actual, apiClient: { ...actual.apiClient, post: api.post, get: api.get } };
});

import { WordDialog } from "./vocabulary-view";

const hello = {
  existing: [],
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
    api.get.mockResolvedValue([]);
    let answer: (value: typeof hello) => void = () => {};
    api.post.mockReturnValue(new Promise((resolve) => (answer = resolve)));
    const user = userEvent.setup();
    renderDialog();
    await user.type(screen.getByLabelText("Русский"), "здравствуйте");
    const term = screen.getByRole("textbox", { name: "Word" });
    await user.type(term, "hello");
    await user.tab();

    // While AI writes, the fields say so in place of their placeholders; the owner's own field does not.
    await waitFor(() => expect(screen.getByLabelText(/O'zbekcha/)).toHaveAttribute("placeholder", "Filling in with AI…"));
    expect(screen.getByLabelText("Русский")).not.toHaveAttribute("placeholder", "Filling in with AI…");
    answer(hello);

    await waitFor(() => expect(screen.getByLabelText(/O'zbekcha/)).toHaveValue("salom"));
    expect(api.post).toHaveBeenCalledWith("/admin/vocabulary/suggest", { term: "hello", kind: "word" });
    expect(screen.getByRole("combobox", { name: /^Level/ })).toHaveValue("A1");
    expect(screen.getByRole("combobox", { name: /^Part of speech/ })).toHaveValue("exclamation");
    expect(screen.getByLabelText(/Pronunciation/)).toHaveValue("/həˈləʊ/");
    expect(screen.getByLabelText(/A1 definition/)).toHaveValue("Something you say when you meet someone.");
    expect(screen.getByLabelText("Русский")).toHaveValue("здравствуйте");
    expect(screen.getAllByText(/Filled in and checked by AI/).length).toBeGreaterThan(0);
    expect(screen.getByLabelText(/O'zbekcha/).className).toContain("border-success");
  });

  it("says why a term was refused", async () => {
    api.get.mockResolvedValue([]);
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
    expect((await screen.findAllByText(/Vocabulary holds single words/)).length).toBeGreaterThan(0);
  });

  it("says as the owner types, before AI or saving, that the word is already in the library", async () => {
    api.post.mockClear();
    api.get.mockResolvedValue([{ id: "1", term: "hello", kind: "word", part_of_speech: "noun", level: "A1", status: "draft" }]);
    const onShowExisting = vi.fn();
    const client = new QueryClient();
    const user = userEvent.setup();
    render(
      <QueryClientProvider client={client}>
        <WordDialog kind="word" word={null} onClose={() => {}} onSaved={() => {}} onShowExisting={onShowExisting} />
      </QueryClientProvider>,
    );
    await user.type(screen.getByRole("textbox", { name: "Word" }), "hello");

    // No leaving the field: typing is enough.
    expect(await screen.findByRole("alert")).toHaveTextContent("“hello” is already in the library");
    expect(api.get).toHaveBeenCalledWith("/admin/vocabulary/existing", { query: { term: "hello" } });
    expect(screen.getByRole("alert")).toHaveTextContent("Vocabulary · noun · A1");
    expect(screen.getByRole("button", { name: "Add word" })).toBeDisabled();
    await user.tab();
    await new Promise((r) => setTimeout(r, 1000));
    expect(api.post).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: /Show it in the list/ }));
    expect(onShowExisting).toHaveBeenCalledWith("hello");
  });
});
