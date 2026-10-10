"use client";

import { useQueryClient } from "@tanstack/react-query";
import { KeyRound } from "lucide-react";
import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toast";
import { errorReason, useChangePassword, usePasswordStatus, useSetPassword } from "@/features/auth/email";
import { errorMessage } from "@/lib/api/errors";

import { useProfile, useUpdateProfile } from "../hooks";

/**
 * The language Engora explains things in: grammar lessons and AI explanations, and the emails
 * it sends. Stored as the profile's native language, which is what the API reads for all of
 * them. The interface itself stays English.
 */
const explanationLanguages = [
  ["uz", "O‘zbekcha"],
  ["ru", "Русский"],
  ["en", "English"],
] as const;

/** Grammar falls back to Uzbek when nothing is set, so that is what an empty profile shows. */
const defaultLanguage = "uz";

export function LanguageSettings() {
  const profile = useProfile();
  const update = useUpdateProfile();

  if (profile.isPending) return <Skeleton className="h-10 max-w-xs" />;

  const saved = profile.data?.native_language?.toLowerCase();
  const value = explanationLanguages.some(([code]) => code === saved) ? (saved as string) : defaultLanguage;

  const change = (next: string) =>
    update.mutate(
      { native_language: next },
      {
        onSuccess: () => toast({ title: "Language saved", variant: "success" }),
        onError: (error) => toast({ title: "Couldn't save", description: errorMessage(error), variant: "error" }),
      },
    );

  return (
    <div className="grid max-w-sm gap-2">
      <Label htmlFor="explanation-language">Explanations and messages</Label>
      <NativeSelect id="explanation-language" value={value} disabled={update.isPending} onChange={(e) => change(e.target.value)}>
        {explanationLanguages.map(([code, label]) => (
          <option key={code} value={code}>
            {label}
          </option>
        ))}
      </NativeSelect>
      <p className="text-caption text-fg-muted">
        Grammar lessons, AI explanations and emails use this language. Exercises and the interface stay in English.
      </p>
    </div>
  );
}

/** The API's own rule, checked here first so the learner hears about it before submitting. */
function passwordProblem(password: string, confirm: string): string | null {
  if (password.length < 8 || !/\p{L}/u.test(password) || !/\p{N}/u.test(password)) {
    return "Use at least 8 characters, with a letter and a number.";
  }
  if (password !== confirm) return "The two passwords don't match.";
  return null;
}

/**
 * A password for an account that has none — one made with Google or an email code. With a
 * password the learner can also sign in with email, on any device.
 */
export function SetPasswordDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const queryClient = useQueryClient();
  const setPassword = useSetPassword();
  const [password, setValue] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);

  const close = (next: boolean) => {
    if (!next) {
      setValue("");
      setConfirm("");
      setError(null);
    }
    onOpenChange(next);
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const problem = passwordProblem(password, confirm);
    setError(problem);
    if (problem) return;
    setPassword.mutate(password, {
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: ["auth", "password-status"] });
        toast({ title: "Password set", description: "You can now sign in with your email and password.", variant: "success" });
        close(false);
      },
      onError: (err) => setError(errorMessage(err)),
    });
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-sm">
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Set a password</DialogTitle>
            <DialogDescription>Then you can sign in with your email as well, on any device.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="new-password">New password</Label>
            <Input id="new-password" type="password" autoComplete="new-password" value={password} onChange={(e) => setValue(e.target.value)} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="confirm-password">Repeat it</Label>
            <Input id="confirm-password" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          </div>
          {error && (
            <p role="alert" className="text-caption text-error">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => close(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={setPassword.isPending}>
              Set password
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * A new password for an account that has one, confirmed with the current password. Other
 * devices stay signed in; only the password changes.
 */
export function ChangePasswordDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const change = useChangePassword();
  const [current, setCurrent] = useState("");
  const [password, setValue] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);

  const close = (next: boolean) => {
    if (!next) {
      setCurrent("");
      setValue("");
      setConfirm("");
      setError(null);
    }
    onOpenChange(next);
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!current) {
      setError("Enter your current password.");
      return;
    }
    const problem = passwordProblem(password, confirm) ?? (password === current ? "Choose a password different from the current one." : null);
    setError(problem);
    if (problem) return;
    change.mutate(
      { current, next: password },
      {
        onSuccess: () => {
          toast({ title: "Password changed", description: "Use the new password next time you sign in.", variant: "success" });
          close(false);
        },
        onError: (err) => {
          const reason = errorReason(err);
          setError(
            reason === "wrong_password"
              ? "Your current password is incorrect."
              : reason === "weak_password"
                ? "Use at least 8 characters, with a letter and a number."
                : errorMessage(err),
          );
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-sm">
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Change password</DialogTitle>
            <DialogDescription>Enter your current password, then the new one twice.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="current-password">Current password</Label>
            <Input id="current-password" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="changed-password">New password</Label>
            <Input id="changed-password" type="password" autoComplete="new-password" value={password} onChange={(e) => setValue(e.target.value)} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="changed-password-confirm">Repeat it</Label>
            <Input id="changed-password-confirm" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          </div>
          {error && (
            <p role="alert" className="text-caption text-error">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => close(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={change.isPending}>
              Change password
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** "Change password" when the account has one, "Set a password" when it has none. */
export function PasswordButton() {
  const status = usePasswordStatus();
  const [open, setOpen] = useState(false);

  if (!status.data) return null;
  const has = status.data.has_password;
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <KeyRound aria-hidden /> {has ? "Change password" : "Set a password"}
      </Button>
      {has ? <ChangePasswordDialog open={open} onOpenChange={setOpen} /> : <SetPasswordDialog open={open} onOpenChange={setOpen} />}
    </>
  );
}
