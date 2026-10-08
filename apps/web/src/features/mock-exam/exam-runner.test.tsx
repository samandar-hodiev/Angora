import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { MockExamRunner } from "./exam-runner";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

async function start(skill: "listening" | "reading" | "writing" | "speaking", level: "A2" | "B1" = "A2") {
  render(<MockExamRunner skill={skill} level={level} />);
  await userEvent.click(screen.getByRole("button", { name: /^start/i }));
}

describe("MockExamRunner", () => {
  it("opens on an intro and only starts the timer on Start", async () => {
    render(<MockExamRunner skill="reading" level="B1" />);
    expect(screen.queryByRole("timer")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /^start/i }));
    expect(screen.getByRole("timer")).toHaveTextContent("35:00");
  });

  it("reading shows the passage beside questions and counts answers", async () => {
    await start("reading");
    expect(screen.getByRole("heading", { name: /the city that cycles/i })).toBeInTheDocument();
    await userEvent.click(screen.getAllByRole("radio", { name: /almost half/i })[0]!);
    expect(screen.getByText("1 of 6 answered")).toBeInTheDocument();
  });

  it("writing refuses paste and counts words", async () => {
    await start("writing");
    const box = screen.getByRole("textbox", { name: /your answer/i });
    fireEvent.paste(box);
    expect(screen.getByText(/copy and paste are turned off/i)).toBeInTheDocument();
    await userEvent.type(box, "Cities should close centres");
    expect(screen.getByText(/^4 words/)).toBeInTheDocument();
  });

  it("listening plays only once", async () => {
    await start("listening");
    const play = screen.getByRole("button", { name: /play the recording/i });
    await userEvent.click(play);
    expect(screen.getByRole("button", { name: /playing/i })).toBeDisabled();
  });

  it("speaking goes from the cue card to preparing to recording", async () => {
    await start("speaking");
    await userEvent.click(screen.getByRole("button", { name: /start preparing/i }));
    expect(screen.getByRole("textbox", { name: /notes/i })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /record/i }));
    expect(screen.getByRole("button", { name: /stop recording/i })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /stop recording/i }));
    await userEvent.click(screen.getByRole("button", { name: /finish section/i }));
    expect(screen.getByRole("heading", { name: /speaking handed in/i })).toBeInTheDocument();
  });
});
