"use client";

import { KeyRound, Mail, ShieldCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/components/ui/toast";
import { OtpInput } from "@/features/auth/components/otp-input";
import { login, OWNER_LANDING_PATH, verifyOwnerCode } from "@/features/auth/session";
import { apiClient } from "@/lib/api";
import { errorMessage } from "@/lib/api/errors";
import { cn } from "@/lib/utils";

import type { EmailChallenge } from "@engora/types";

/**
 * The Owner Console's own door.
 *
 * Two ways in, because there are two kinds of people here and they should not share a
 * mechanism:
 *
 *   the owner   one configured address, and a code emailed to it. There is no password to
 *               guess, to reuse, or to be talked out of someone over the phone.
 *   staff       email and a password the owner set for them and handed over directly.
 *
 * Neither is the learner sign-in. A console that accepts learner credentials is a console
 * one password-reuse away from being opened by whoever bought a subscription.
 */

type Mode = "owner" | "staff";

export function ConsoleLogin() {
  const [mode, setMode] = useState<Mode>("owner");

  return (
    <main id="main" className="grid min-h-dvh place-items-center px-4 py-12">
      <div className="w-full max-w-md">
        <div className="mb-6 grid justify-items-center gap-2 text-center">
          <span className="grid size-11 place-items-center rounded-xl bg-primary text-primary-foreground">
            <ShieldCheck className="size-6" aria-hidden />
          </span>
          <h1 className="text-h2">Owner Console</h1>
          <p className="text-body-sm text-fg-secondary">
            This is not the learner sign-in. Access here is granted by the owner.
          </p>
        </div>

        <div className="rounded-xl border bg-surface p-6">
          <div role="group" aria-label="How you sign in" className="mb-5 grid grid-cols-2 gap-1 rounded-lg border bg-background p-1">
            {(
              [
                ["owner", "I'm the owner"],
                ["staff", "I'm staff"],
              ] as [Mode, string][]
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                aria-pressed={mode === value}
                onClick={() => setMode(value)}
                className={cn(
                  "rounded-md px-3 py-1.5 text-body-sm font-medium transition-colors duration-micro",
                  "outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40",
                  mode === value ? "bg-primary text-primary-foreground" : "text-fg-secondary hover:bg-surface-hover",
                )}
              >
                {label}
              </button>
            ))}
          </div>

          {mode === "owner" ? <OwnerCodeForm /> : <StaffPasswordForm />}
        </div>
      </div>
    </main>
  );
}

function OwnerCodeForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sendCode = async () => {
    setBusy(true);
    setError(null);
    try {
      const challenge = await apiClient.post<EmailChallenge>("/auth/owner/start", { email: email.trim() }, { auth: false });
      setSent(true);
      // Only ever present when no mail provider is configured, which is a development build.
      if (challenge.dev_code) {
        toast({ title: `Development code: ${challenge.dev_code}`, description: "Email is not configured on this build." });
      }
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const verify = async (value: string) => {
    setBusy(true);
    setError(null);
    try {
      await verifyOwnerCode({ email: email.trim(), code: value });
      router.replace(OWNER_LANDING_PATH);
    } catch (err) {
      setError(errorMessage(err));
      setCode("");
      setBusy(false);
    }
  };

  if (!sent) {
    return (
      <form
        className="grid gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          void sendCode();
        }}
      >
        <div className="grid gap-1.5">
          <Label htmlFor="owner-email">Owner email</Label>
          <Input
            id="owner-email"
            type="email"
            required
            autoComplete="email"
            value={email}
            placeholder="you@example.com"
            onChange={(event) => setEmail(event.target.value)}
          />
          <p className="text-caption text-fg-muted">
            Only the address configured as the owner can receive a code.
          </p>
        </div>

        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <Button type="submit" loading={busy} disabled={email.trim().length < 3}>
          <Mail aria-hidden /> Send me a code
        </Button>
      </form>
    );
  }

  return (
    <div className="grid gap-4">
      <div className="grid gap-1 text-center">
        <p className="text-body-sm text-fg-secondary">
          We sent a six-digit code to <span className="font-medium text-foreground">{email.trim()}</span>.
        </p>
      </div>
      <div className="grid justify-items-center gap-3">
        <OtpInput
          value={code}
          onChange={(value) => {
            setCode(value);
            setError(null);
          }}
          onComplete={(value) => void verify(value)}
          disabled={busy}
          invalid={Boolean(error)}
          autoFocus
          label="Owner sign-in code"
        />
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="flex items-center justify-between gap-2">
        <Button variant="ghost" size="sm" onClick={() => { setSent(false); setCode(""); setError(null); }}>
          Change email
        </Button>
        <Button variant="ghost" size="sm" loading={busy} onClick={() => void sendCode()}>
          Send another code
        </Button>
      </div>
    </div>
  );
}

function StaffPasswordForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      className="grid gap-4"
      onSubmit={async (event) => {
        event.preventDefault();
        setBusy(true);
        setError(null);
        try {
          await login({ email: email.trim(), password }, OWNER_LANDING_PATH);
          router.replace(OWNER_LANDING_PATH);
        } catch (err) {
          setError(errorMessage(err));
          setBusy(false);
        }
      }}
    >
      <div className="grid gap-1.5">
        <Label htmlFor="staff-email">Email</Label>
        <Input
          id="staff-email"
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="staff-password">Password</Label>
        <Input
          id="staff-password"
          type="password"
          required
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
        <p className="text-caption text-fg-muted">The owner sets this for you. Change it once you are in.</p>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Button type="submit" loading={busy} disabled={!email.trim() || !password}>
        <KeyRound aria-hidden /> Sign in
      </Button>
    </form>
  );
}
