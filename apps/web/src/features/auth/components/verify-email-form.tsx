"use client";

import { CircleAlert } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { errorMessage } from "@/lib/api/errors";
import { formatDuration } from "@/lib/audio";
import { useIsClient, useNow } from "@/lib/clock";

import { errorNumber, errorReason, useResendEmailCode } from "../email";
import { clearChallenge, loadChallenge, saveChallenge } from "../email-challenge";
import { useVerifyEmail } from "../hooks";
import { browserTimezone, SETUP_PROFILE_PATH } from "../session";

import { OtpInput } from "./otp-input";

export function VerifyEmailForm({ email }: { email: string }) {
  // The resend countdown comes from this tab's storage, so render after hydration.
  const isClient = useIsClient();
  if (!isClient) return <Skeleton className="h-48 rounded-xl" />;
  return <VerifyEmailFields email={email} />;
}

function VerifyEmailFields({ email }: { email: string }) {
  const router = useRouter();
  const verify = useVerifyEmail();
  const resend = useResendEmailCode();
  const now = useNow();
  const [code, setCode] = useState("");
  const [error, setError] = useState<ReactNode>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [resendAt, setResendAt] = useState<number>(() => {
    const challenge = loadChallenge(email);
    return challenge ? Date.parse(challenge.resend_available_at) : 0;
  });
  const wait = Math.max(0, Math.ceil((resendAt - now) / 1000));

  const submit = async (value: string) => {
    if (value.length !== 6 || verify.isPending) return;
    setError(null);
    setNotice(null);
    try {
      await verify.mutateAsync({ email, code: value, timezone: browserTimezone() });
      clearChallenge();
      router.replace(SETUP_PROFILE_PATH);
    } catch (err) {
      const reason = errorReason(err);
      const left = errorNumber(err, "attempts_remaining");
      if (reason === "code_invalid" && left !== undefined) {
        setError(`That code is incorrect. ${left} ${left === 1 ? "attempt" : "attempts"} left.`);
      } else if (reason === "code_expired") {
        setError("This code has expired. Request a new code.");
      } else if (reason === "attempts_exceeded") {
        setError("Too many incorrect attempts. Request a new code.");
      } else if (reason === "email_registered") {
        setError(
          <>
            This email is already registered.{" "}
            <Link href={`/login?email=${encodeURIComponent(email)}`} className="font-medium underline underline-offset-4">
              Log in
            </Link>
          </>,
        );
      } else {
        setError(errorMessage(err));
      }
      setCode("");
    }
  };

  const onResend = async () => {
    setError(null);
    setNotice(null);
    try {
      const challenge = await resend.mutateAsync(email);
      saveChallenge(challenge);
      setResendAt(Date.parse(challenge.resend_available_at));
      setCode("");
      setNotice("We sent a new code to your email.");
    } catch (err) {
      const retry = errorNumber(err, "retry_after_seconds");
      if (retry !== undefined) setResendAt(Date.now() + retry * 1000);
      setError(errorMessage(err));
    }
  };

  return (
    <div className="grid gap-5">
      <p className="text-center text-body-sm text-fg-secondary">
        Enter the 6-digit code we sent to <span className="font-medium break-all text-foreground">{email}</span>
      </p>

      {error && (
        <Alert variant="destructive" id="otp-error">
          <CircleAlert />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {notice && (
        <p role="status" className="text-center text-body-sm text-primary">
          {notice}
        </p>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit(code);
        }}
        className="grid gap-5"
      >
        <OtpInput
          value={code}
          onChange={setCode}
          onComplete={(value) => void submit(value)}
          invalid={Boolean(error)}
          disabled={verify.isPending}
          autoFocus
          describedBy={error ? "otp-error" : undefined}
        />
        <Button type="submit" variant="liquid" size="lg" className="w-full" loading={verify.isPending} disabled={code.length !== 6}>
          Verify
        </Button>
      </form>

      <div className="flex flex-wrap items-center justify-between gap-3 text-body-sm">
        {wait > 0 ? (
          <span className="text-fg-muted tabular-nums">Resend code in {formatDuration(wait * 1000)}</span>
        ) : (
          <Button variant="link" className="h-auto" onClick={() => void onResend()} loading={resend.isPending}>
            Resend code
          </Button>
        )}
        <Link
          href={`/register/email?email=${encodeURIComponent(email)}`}
          className="text-fg-secondary underline-offset-4 hover:text-primary hover:underline"
        >
          Change email
        </Link>
      </div>
    </div>
  );
}
