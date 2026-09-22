import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { ContentStatusState, MapCategory, MapTopic } from "../types";

/**
 * The map and the schema both say the same thing in colour: green means a learner can read
 * it, grey means they cannot. That promise is easy to break silently — a status added to the
 * API with no tone mapped to it just falls back to "no colour" — so it is asserted here.
 */

function topic(name: string, status: ContentStatusState, overrides: Partial<MapTopic> = {}): MapTopic {
  const published = status === "published" ? 6 : status === "partially_published" ? 1 : 0;
  return {
    id: `id-${name}`,
    slug: name.toLowerCase().replace(/\s+/g, "-"),
    name,
    description: `${name} description`,
    level: "B1",
    cefr_levels: ["A1", "A2", "B1", "B2", "C1", "C2"],
    topic_status: "published",
    content: { status, published_levels: published, total_levels: status === "not_created" ? 0 : 6 },
    levels: [],
    languages: [],
    question_count: 0,
    ...overrides,
  } as MapTopic;
}

const fixture: MapCategory[] = [
  {
    slug: "articles",
    name: "Articles",
    topics: [topic("The", "published"), topic("Zero Article", "not_created"), topic("A / An", "draft")],
  },
  { slug: "nouns", name: "Nouns", topics: [topic("Compound Nouns", "not_created")] },
];

const map = vi.hoisted(() => ({ state: { data: [] as MapCategory[], isPending: false, isError: false, error: null, refetch: () => {} } }));
vi.mock("../hooks", () => ({ useGrammarMap: () => map.state }));

function row(name: string): HTMLElement {
  return screen.getByRole("link", { name: new RegExp(name, "i") });
}

describe("GrammarSchemaDialog", () => {
  it("colours a node by whether the topic carries content, and links it to the builder", async () => {
    map.state = { ...map.state, data: fixture };
    const { GrammarSchemaDialog } = await import("./grammar-schema-dialog");

    render(<GrammarSchemaDialog open onOpenChange={() => {}} language="en" />);

    const written = row("^The");
    expect(written.className).toContain("bg-success/10");
    expect(written).toHaveAttribute("href", "/owner/content/grammar/the?lang=en");

    const blank = row("Zero Article");
    expect(blank.className).toContain("border-dashed");
    expect(blank.className).not.toContain("bg-success/10");
  });

  it("counts a draft as written, because somebody has already done that work", async () => {
    map.state = { ...map.state, data: fixture };
    const { GrammarSchemaDialog } = await import("./grammar-schema-dialog");

    render(<GrammarSchemaDialog open onOpenChange={() => {}} language="en" />);

    // Articles: "The" published + "A / An" draft written, "Zero Article" not.
    expect(screen.getByText("2/3 written")).toBeInTheDocument();
    expect(screen.getByText(/2 of 4 written/)).toBeInTheDocument();
  });

  it("narrows the schema to what was searched, and drops categories that empty out", async () => {
    map.state = { ...map.state, data: fixture };
    const { GrammarSchemaDialog } = await import("./grammar-schema-dialog");

    render(<GrammarSchemaDialog open onOpenChange={() => {}} language="en" />);
    await userEvent.type(screen.getByLabelText(/search the curriculum/i), "compound");

    expect(screen.getByText("Nouns")).toBeInTheDocument();
    expect(screen.queryByText("Articles")).not.toBeInTheDocument();
  });

  it("closes itself when a node is picked, so the builder is not opened behind a modal", async () => {
    map.state = { ...map.state, data: fixture };
    const onOpenChange = vi.fn();
    const { GrammarSchemaDialog } = await import("./grammar-schema-dialog");

    render(<GrammarSchemaDialog open onOpenChange={onOpenChange} language="en" />);
    await userEvent.click(row("Zero Article"));

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});

describe("GrammarMapView rows", () => {
  it("tints every content state, green only when a learner can read it", async () => {
    map.state = { ...map.state, data: fixture };
    const { GrammarMapView } = await import("./grammar-map-view");

    render(<GrammarMapView />);

    expect(row("^The").className).toContain("bg-success/[0.08]");
    expect(row("Zero Article").className).toContain("bg-surface-active/25");
    expect(row("A / An").className).toContain("bg-surface-active/45");
    expect(row("A / An").className).not.toContain("success");
  });

  it("labels the grey rows rather than leaving them blank", async () => {
    map.state = { ...map.state, data: fixture };
    const { GrammarMapView } = await import("./grammar-map-view");

    render(<GrammarMapView />);

    expect(within(row("Zero Article")).getByText("Not created")).toBeInTheDocument();
    expect(within(row("^The")).getByText("Published")).toBeInTheDocument();
  });
});
