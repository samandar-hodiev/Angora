import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { OtpInput } from "./otp-input";

function Harness({ onComplete }: { onComplete: (code: string) => void }) {
  const [value, setValue] = useState("");
  return (
    <>
      <OtpInput value={value} onChange={setValue} onComplete={onComplete} />
      <output data-testid="value">{value}</output>
    </>
  );
}

describe("OtpInput", () => {
  it("fills digit by digit and completes", async () => {
    const onComplete = vi.fn();
    render(<Harness onComplete={onComplete} />);
    await userEvent.click(screen.getByLabelText("Digit 1 of 6"));
    await userEvent.keyboard("12a3456");

    expect(screen.getByTestId("value")).toHaveTextContent("123456");
    expect(onComplete).toHaveBeenCalledWith("123456");
  });

  it("accepts a pasted code and supports backspace", async () => {
    const onComplete = vi.fn();
    render(<Harness onComplete={onComplete} />);
    await userEvent.click(screen.getByLabelText("Digit 1 of 6"));
    await userEvent.paste("98 76 54");
    expect(onComplete).toHaveBeenCalledWith("987654");

    await userEvent.click(screen.getByLabelText("Digit 6 of 6"));
    await userEvent.keyboard("{Backspace}{Backspace}");
    expect(screen.getByTestId("value")).toHaveTextContent("9876");
  });

  it("is an accessible group", () => {
    render(<Harness onComplete={vi.fn()} />);
    expect(screen.getByRole("group", { name: "Verification code" })).toBeInTheDocument();
    expect(screen.getAllByRole("textbox")).toHaveLength(6);
    expect(screen.getByLabelText("Digit 1 of 6")).toHaveAttribute("autocomplete", "one-time-code");
  });
});
