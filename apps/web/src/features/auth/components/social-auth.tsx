"use client";

import { CircleAlert } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api/errors";
import { useTheme } from "@/providers/theme-provider";

import { useGoogleLogin } from "../hooks";
import { browserTimezone, ONBOARDING_PATH } from "../session";

/**
 * "Continue with Google" via Google Identity Services.
 *
 * Google renders its own button and returns a signed ID token; the token goes through the
 * session route to POST /api/v1/auth/google, where the API verifies it. The same endpoint
 * serves the mobile apps (native Google Sign-In SDKs), so nothing here is web-only logic.
 *
 * Phone-number sign-in (SMS OTP) is planned and will sit next to this button.
 */

const GIS_SRC = "https://accounts.google.com/gsi/client";

interface GoogleCredentialResponse {
  credential: string;
}

interface GoogleIdentityServices {
  accounts: {
    id: {
      initialize(config: {
        client_id: string;
        callback: (response: GoogleCredentialResponse) => void;
        ux_mode?: "popup" | "redirect";
        auto_select?: boolean;
        cancel_on_tap_outside?: boolean;
        itp_support?: boolean;
        use_fedcm_for_button?: boolean;
      }): void;
      renderButton(
        parent: HTMLElement,
        options: {
          type?: "standard" | "icon";
          theme?: "outline" | "filled_blue" | "filled_black";
          size?: "large" | "medium" | "small";
          text?: "signin_with" | "signup_with" | "continue_with" | "signin";
          shape?: "rectangular" | "pill" | "circle" | "square";
          logo_alignment?: "left" | "center";
          width?: number;
          locale?: string;
        },
      ): void;
    };
  };
}

declare global {
  interface Window {
    google?: GoogleIdentityServices;
  }
}

let gisPromise: Promise<GoogleIdentityServices> | null = null;

function loadGoogleIdentityServices(): Promise<GoogleIdentityServices> {
  if (window.google?.accounts?.id) return Promise.resolve(window.google);
  gisPromise ??= new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = GIS_SRC;
    script.async = true;
    script.onload = () => (window.google?.accounts?.id ? resolve(window.google) : reject(new Error("GIS unavailable")));
    script.onerror = () => {
      gisPromise = null;
      script.remove();
      reject(new Error("GIS failed to load"));
    };
    document.head.appendChild(script);
  });
  return gisPromise;
}

type GoogleButtonState = "loading" | "ready" | "unavailable";

function GoogleButton({
  clientId,
  mode,
  redirectTo,
  onError,
}: {
  clientId: string;
  mode: "signin" | "signup";
  redirectTo: string;
  onError: (message: string | null) => void;
}) {
  const router = useRouter();
  const { resolved: resolvedTheme } = useTheme();
  const googleLogin = useGoogleLogin(redirectTo);
  const containerRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<GoogleButtonState>("loading");

  // Keep the latest handler without re-initialising Google on every render.
  const handleCredential = useRef<(response: GoogleCredentialResponse) => void>(() => {});
  useEffect(() => {
    handleCredential.current = async ({ credential }) => {
      onError(null);
      try {
        const session = await googleLogin.mutateAsync({ id_token: credential, timezone: browserTimezone() });
        router.replace(session.is_new_user ? ONBOARDING_PATH : redirectTo);
      } catch (error) {
        onError(
          error instanceof ApiError && error.code !== "INTERNAL_ERROR"
            ? error.message
            : "Google sign-in failed. Please try again.",
        );
      }
    };
  });

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let cancelled = false;

    loadGoogleIdentityServices()
      .then((google) => {
        if (cancelled) return;
        google.accounts.id.initialize({
          client_id: clientId,
          callback: (response) => handleCredential.current(response),
          ux_mode: "popup",
          cancel_on_tap_outside: true,
          itp_support: true,
          use_fedcm_for_button: true,
        });
        container.replaceChildren();
        google.accounts.id.renderButton(container, {
          type: "standard",
          theme: resolvedTheme === "dark" ? "filled_black" : "outline",
          size: "large",
          text: mode === "signup" ? "signup_with" : "continue_with",
          shape: "rectangular",
          logo_alignment: "center",
          // GIS accepts 200–400px; follow the card width (the container itself is hidden until ready).
          width: Math.max(200, Math.min(400, Math.floor(container.parentElement?.getBoundingClientRect().width ?? 320))),
        });
        setState("ready");
      })
      .catch(() => {
        if (!cancelled) setState("unavailable");
      });

    return () => {
      cancelled = true;
    };
  }, [clientId, mode, resolvedTheme]);

  return (
    <div className="grid gap-2">
      <div
        ref={containerRef}
        aria-busy={state === "loading" || googleLogin.isPending}
        // Google's iframe must not inherit the page's dark color-scheme (it would paint a white box).
        className={state === "ready" ? "flex min-h-11 justify-center scheme-normal" : "hidden"}
      />
      {state === "loading" && (
        <Button variant="outline" className="w-full" loading disabled>
          Loading Google sign-in
        </Button>
      )}
      {state === "unavailable" && (
        <Button variant="outline" className="w-full" disabled>
          <GoogleMark />
          Google sign-in is unavailable
        </Button>
      )}
      {googleLogin.isPending && (
        <p role="status" className="text-center text-caption text-fg-muted">
          Signing you in with Google…
        </p>
      )}
    </div>
  );
}

function GoogleMark() {
  return (
    <svg viewBox="0 0 48 48" aria-hidden className="size-4">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}

export function SocialAuth({
  mode = "signin",
  redirectTo = "/app/dashboard",
}: {
  mode?: "signin" | "signup";
  redirectTo?: string;
}) {
  const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="grid gap-4">
      {error && (
        <Alert variant="destructive">
          <CircleAlert />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {clientId ? (
        <GoogleButton clientId={clientId} mode={mode} redirectTo={redirectTo} onError={setError} />
      ) : (
        <div className="grid gap-2">
          <Button variant="outline" className="w-full" disabled aria-describedby="google-not-configured">
            <GoogleMark />
            Continue with Google
          </Button>
          <p id="google-not-configured" className="text-center text-caption text-fg-muted">
            Google sign-in is not configured yet.
          </p>
        </div>
      )}

      <div className="flex items-center gap-3 text-caption text-fg-muted" aria-hidden>
        <span className="h-px flex-1 bg-border" />
        or continue with email
        <span className="h-px flex-1 bg-border" />
      </div>
    </div>
  );
}
