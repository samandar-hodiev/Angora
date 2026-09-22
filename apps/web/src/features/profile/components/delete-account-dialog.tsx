"use client";

import { AlertTriangle, Mail, ShieldAlert } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/components/ui/toast";
import { OtpInput } from "@/features/auth/components/otp-input";
import { useLogout } from "@/features/auth/hooks";
import { errorMessage } from "@/lib/api/errors";

import { useConfirmAccountDeletion, useResendAccountDeletion, useStartAccountDeletion } from "../account";

/**
 * Closing your own account.
 *
 * Three steps, and each one is there for a reason rather than for ceremony:
 *
 *   address   Typing it out is the difference between "I clicked the red button" and "I know
 *             which account I am closing". It is checked against the session server-side.
 *   code      A code to the mailbox proves the person asking still holds the address. A
 *             session on a borrowed laptop does not.
 *   warning   The last screen says what actually goes, including a subscription that has
 *             been paid for, because that is the part people do not think of until after.
 *
 * The code is only spent on the final confirmation, so backing out of the warning leaves it
 * usable and nothing has happened yet.
 */

type Step = "email" | "code" | "confirm";

export function DeleteAccountDialog({
  open,
  onOpenChange,
  accountEmail,
  planName,
  paidPlan,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  accountEmail: string;
  planName?: string;
  paidPlan: boolean;
}) {
  const router = useRouter();
  const logout = useLogout();
  const start = useStartAccountDeletion();
  const resend = useResendAccountDeletion();
  const confirm = useConfirmAccountDeletion();

  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);

  // A closed dialog is a cancelled deletion: nothing carries over to the next time it opens.
  useEffect(() => {
    if (open) return;
    const timer = window.setTimeout(() => {
      setStep("email");
      setEmail("");
      setCode("");
      setError(null);
    }, 200);
    return () => window.clearTimeout(timer);
  }, [open]);

  const emailMatches = email.trim().toLowerCase() === accountEmail.trim().toLowerCase();

  const sendCode = () => {
    setError(null);
    start.mutate(undefined, {
      onSuccess: () => setStep("code"),
      onError: (err) => setError(errorMessage(err)),
    });
  };

  const deleteNow = () => {
    setError(null);
    confirm.mutate(
      { email: email.trim(), code },
      {
        onSuccess: async () => {
          toast({ title: "Your account has been deleted", variant: "success" });
          // The refresh token went with the account, so signing out is a formality that is
          // allowed to fail; what matters is that this browser stops holding a session.
          await logout.mutateAsync().catch(() => undefined);
          router.replace("/");
        },
        onError: (err) => {
          setError(errorMessage(err));
          // A rejected code is a step backwards, not a dead end.
          setStep("code");
          setCode("");
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {step === "email" && (
          <>
            <DialogHeader>
              <DialogTitle>Delete your Engora account?</DialogTitle>
              <DialogDescription>
                This cannot be undone. To continue, type the email address on this account and we will send a
                confirmation code to it.
              </DialogDescription>
            </DialogHeader>

            <div className="grid gap-1.5">
              <Label htmlFor="delete-email">Email address</Label>
              <Input
                id="delete-email"
                type="email"
                autoComplete="off"
                value={email}
                placeholder={accountEmail}
                onChange={(event) => setEmail(event.target.value)}
              />
              {email.length > 0 && !emailMatches && (
                <p className="text-caption text-error">This is not the email address on this account.</p>
              )}
            </div>

            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button variant="destructive" disabled={!emailMatches} loading={start.isPending} onClick={sendCode}>
                <Mail aria-hidden /> Send code
              </Button>
            </DialogFooter>
          </>
        )}

        {step === "code" && (
          <>
            <DialogHeader>
              <DialogTitle>Enter the code we sent</DialogTitle>
              <DialogDescription>
                We sent a six-digit code to <span className="font-medium text-foreground">{accountEmail}</span>. It
                expires in ten minutes.
              </DialogDescription>
            </DialogHeader>

            <div className="grid justify-items-center gap-3 py-2">
              <OtpInput
                value={code}
                onChange={(value) => {
                  setCode(value);
                  setError(null);
                }}
                onComplete={() => setStep("confirm")}
                invalid={Boolean(error)}
                autoFocus
                label="Account deletion code"
              />
              <Button
                variant="ghost"
                size="sm"
                loading={resend.isPending}
                onClick={() =>
                  resend.mutate(undefined, {
                    onSuccess: () => toast({ title: "A new code is on its way" }),
                    onError: (err) => setError(errorMessage(err)),
                  })
                }
              >
                Send another code
              </Button>
            </div>

            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <DialogFooter>
              <Button variant="outline" onClick={() => setStep("email")}>
                Back
              </Button>
              <Button variant="destructive" disabled={code.length !== 6} onClick={() => setStep("confirm")}>
                Continue
              </Button>
            </DialogFooter>
          </>
        )}

        {step === "confirm" && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <ShieldAlert className="size-5 text-error" aria-hidden />
                Last chance
              </DialogTitle>
              <DialogDescription>Deleting {accountEmail} removes all of the following, permanently.</DialogDescription>
            </DialogHeader>

            <ul className="grid gap-1.5 text-body-sm text-fg-secondary">
              <li>• Your profile, level and learning plan</li>
              <li>• Every lesson, assessment, practice attempt and mistake you have recorded</li>
              <li>• Your vocabulary, streaks and achievements</li>
              <li>• Your notifications and account settings</li>
            </ul>

            {paidPlan && (
              <Alert variant="destructive">
                <AlertTriangle aria-hidden />
                <AlertTitle>Your {planName ?? "paid"} subscription ends immediately</AlertTitle>
                <AlertDescription>
                  Deleting the account cancels it with no refund for the remainder of the period. If you only want to
                  stop being billed, close this and manage the plan instead.
                </AlertDescription>
              </Alert>
            )}

            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <DialogFooter>
              <Button variant="outline" onClick={() => setStep("code")}>
                Back
              </Button>
              <Button variant="destructive" loading={confirm.isPending} onClick={deleteNow}>
                Delete my account
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
