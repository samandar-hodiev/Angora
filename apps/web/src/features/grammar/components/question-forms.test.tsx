import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { GrammarQuestion } from "@engora/types";

import { QuestionForm } from "./question-forms";

const question = {
  id: "q1",
  type: "multiple_choice",
  prompt: "Pick the right sentence.",
  payload: { options: ["I have an dog.", "I have a dog."] },
} as unknown as GrammarQuestion;

/**
 * In test mode an answer is recorded and its mark withheld. The learner still has to see
 * which option they chose — the form used to drop the highlight the moment it locked.
 */
describe("ChoiceForm in test mode", () => {
  it("keeps the recorded choice highlighted while the mark is withheld", () => {
    render(
      <QuestionForm
        question={question}
        value={{ index: 0 }}
        onChange={() => {}}
        onSubmit={() => {}}
        disabled
        correct={null}
      />,
    );
    expect(screen.getByRole("radio", { name: /an dog/ }).className).toContain("bg-primary-subtle");
    expect(screen.getByRole("radio", { name: /a dog\.$/ }).className).not.toContain("bg-primary-subtle");
  });
});
