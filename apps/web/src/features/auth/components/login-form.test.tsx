import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/api/errors";

import { LoginForm } from "./login-form";

const replace = vi.fn();
const mutateAsync = vi.fn();

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace }) }));
vi.mock("../hooks", () => ({ useLogin: () => ({ mutateAsync }) }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));

describe("LoginForm", () => {
  beforeEach(() => {
    replace.mockReset();
    mutateAsync.mockReset();
  });

  it("validates on the client before calling the API", async () => {
    render(<LoginForm redirectTo="/app/dashboard" />);
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByText("Email is required")).toBeInTheDocument();
    expect(screen.getByText("Password is required")).toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toHaveAttribute("aria-invalid", "true");
    expect(mutateAsync).not.toHaveBeenCalled();
  });

  it("signs in and redirects", async () => {
    mutateAsync.mockResolvedValueOnce({});
    render(<LoginForm redirectTo="/app/profile" />);

    await userEvent.type(screen.getByLabelText("Email"), "learner@example.com");
    await userEvent.type(screen.getByLabelText("Password"), "correct-horse");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));

    expect(mutateAsync).toHaveBeenCalledWith({ email: "learner@example.com", password: "correct-horse" });
    expect(replace).toHaveBeenCalledWith("/app/profile");
  });

  it("prefills the email when coming from sign-up", () => {
    render(<LoginForm redirectTo="/app/dashboard" defaultEmail="learner@example.com" />);
    expect(screen.getByLabelText("Email")).toHaveValue("learner@example.com");
  });

  it("shows the API error without redirecting", async () => {
    mutateAsync.mockRejectedValueOnce(new ApiError(401, { code: "UNAUTHORIZED", message: "Invalid email or password" }));
    render(<LoginForm redirectTo="/app/dashboard" />);

    await userEvent.type(screen.getByLabelText("Email"), "learner@example.com");
    await userEvent.type(screen.getByLabelText("Password"), "wrong-password");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Invalid email or password");
    expect(replace).not.toHaveBeenCalled();
  });

  it("links to password recovery", () => {
    render(<LoginForm redirectTo="/app/dashboard" />);
    expect(screen.getByRole("link", { name: "Forgot password?" })).toHaveAttribute("href", "/forgot-password");
  });
});
