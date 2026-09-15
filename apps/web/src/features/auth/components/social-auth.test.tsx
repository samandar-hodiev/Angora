import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SocialAuth } from "./social-auth";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn() }) }));
vi.mock("@/providers/theme-provider", () => ({ useTheme: () => ({ resolved: "dark" }) }));
vi.mock("../hooks", () => ({ useGoogleLogin: () => ({ mutateAsync: vi.fn(), isPending: false }) }));

describe("SocialAuth", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    document.head.querySelectorAll("script[src*='accounts.google.com']").forEach((s) => s.remove());
  });

  it("shows a disabled Google button when no client ID is configured", () => {
    vi.stubEnv("NEXT_PUBLIC_GOOGLE_CLIENT_ID", "");
    render(<SocialAuth />);

    expect(screen.getByRole("button", { name: /continue with google/i })).toBeDisabled();
    expect(screen.getByText(/not configured yet/i)).toBeInTheDocument();
    expect(document.head.querySelector("script[src*='accounts.google.com']")).toBeNull();
  });

  it("loads Google Identity Services when a client ID is configured", () => {
    vi.stubEnv("NEXT_PUBLIC_GOOGLE_CLIENT_ID", "web-client.apps.googleusercontent.com");
    render(<SocialAuth />);

    expect(screen.getByRole("button", { name: /loading google sign-in/i })).toBeDisabled();
    expect(document.head.querySelector("script[src='https://accounts.google.com/gsi/client']")).not.toBeNull();
    expect(screen.queryByText(/apple/i)).toBeNull();
  });
});
