"use client";

import { Copy, KeyRound, ShieldAlert, ShieldCheck, UserMinus, UserPlus } from "lucide-react";
import { useState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { toast } from "@/components/ui/toast";
import { errorMessage } from "@/lib/api/errors";
import { cn } from "@/lib/utils";

import { DataTable, type Column } from "../components/data-table";
import { LiveDataState } from "../components/live-state";
import { ActionMenu, ConfirmDialog, OwnerPageHeader, SectionCard } from "../components/primitives";
import { useIsPlatformOwner } from "../guard";
import { formatDate } from "../lib/format";
import {
  suggestPassword,
  useAddStaff,
  useChangeStaffRole,
  useResetStaffPassword,
  useRevokeStaff,
  useStaff,
  useStaffRoles,
  type StaffMember,
  type StaffRole,
} from "../staff";

/**
 * The people who run the platform.
 *
 * The owner is on this list and cannot be edited from it — not by an administrator, and not
 * by themselves. That is the point of the page: one account that grants access, and no path
 * from inside the console to a second one.
 */

const roleLabels: Record<string, string> = {
  OWNER: "Owner",
  ADMIN: "Administrator",
  CONTENT_MANAGER: "Content manager",
  SUPPORT: "Support",
  ANALYST: "Analyst",
};

const roleTone: Record<string, string> = {
  OWNER: "border-transparent bg-primary text-primary-foreground",
  ADMIN: "border-transparent bg-warning/20 text-warning-foreground",
};

export function StaffView() {
  const isOwner = useIsPlatformOwner();
  const staff = useStaff();
  const roles = useStaffRoles();
  const changeRole = useChangeStaffRole();
  const revoke = useRevokeStaff();

  const [adding, setAdding] = useState(false);
  const [resetting, setResetting] = useState<StaffMember | null>(null);
  const [revoking, setRevoking] = useState<StaffMember | null>(null);

  const columns: Column<StaffMember>[] = [
    {
      key: "email",
      header: "Account",
      width: "22rem",
      cell: (row) => (
        <div className="grid min-w-0 gap-0.5">
          <span className="truncate font-medium">{row.email}</span>
          {row.created_by_email && <span className="truncate text-caption text-fg-muted">Added by {row.created_by_email}</span>}
        </div>
      ),
    },
    {
      key: "role",
      header: "Role",
      cell: (row) =>
        row.role === "OWNER" ? (
          <Badge className={roleTone.OWNER}>
            <ShieldCheck aria-hidden /> Owner
          </Badge>
        ) : (
          <NativeSelect
            aria-label={`Role for ${row.email}`}
            value={row.role}
            disabled={changeRole.isPending}
            onChange={(event) =>
              changeRole.mutate(
                { id: row.id, role: event.target.value as StaffRole },
                {
                  onSuccess: () => toast({ title: `${row.email} is now ${roleLabels[event.target.value]}`, variant: "success" }),
                  onError: (error) => toast({ title: "That change was refused", description: errorMessage(error), variant: "error" }),
                },
              )
            }
            className="h-8 w-48 text-body-sm"
          >
            {(roles.data ?? []).map((option) => (
              <option key={option.role} value={option.role}>
                {roleLabels[option.role] ?? option.role}
              </option>
            ))}
          </NativeSelect>
        ),
    },
    {
      key: "state",
      header: "State",
      hideBelow: "md",
      cell: (row) => (
        <span className="flex flex-wrap items-center gap-1.5">
          {row.must_change_password && (
            <Badge variant="secondary" className="gap-1">
              <KeyRound aria-hidden /> Password not changed
            </Badge>
          )}
          <span className="text-caption text-fg-muted tabular-nums">
            {row.active_sessions} {row.active_sessions === 1 ? "session" : "sessions"}
          </span>
        </span>
      ),
    },
    {
      key: "last_login",
      header: "Last signed in",
      hideBelow: "lg",
      cell: (row) => (
        <span className="text-fg-muted tabular-nums">{row.last_login_at ? formatDate(row.last_login_at) : "Never"}</span>
      ),
    },
    {
      key: "added",
      header: "Added",
      hideBelow: "xl",
      cell: (row) => <span className="text-fg-muted tabular-nums">{formatDate(row.created_at)}</span>,
    },
    {
      key: "actions",
      header: "Actions",
      align: "right",
      srOnlyHeader: true,
      width: "3rem",
      cell: (row) =>
        row.role === "OWNER" ? (
          <span className="text-caption text-fg-muted">—</span>
        ) : (
          <ActionMenu
            label={`Actions for ${row.email}`}
            items={[
              { label: "Set a new password", icon: KeyRound, onSelect: () => setResetting(row) },
              {
                label: "Remove console access",
                icon: UserMinus,
                separatorBefore: true,
                onSelect: () => setRevoking(row),
              },
            ]}
          />
        ),
    },
  ];

  if (!isOwner) {
    return (
      <>
        <OwnerPageHeader
          title="Staff"
          description="Who can open this console."
          breadcrumbs={[{ label: "Owner", href: "/owner/dashboard" }, { label: "Staff" }]}
        />
        <Alert variant="destructive">
          <ShieldAlert aria-hidden />
          <AlertDescription>
            Only the owner can see or change who has access. If you need a change here, ask them.
          </AlertDescription>
        </Alert>
      </>
    );
  }

  return (
    <>
      <OwnerPageHeader
        title="Staff"
        description="Who can open this console, and what each of them can do."
        breadcrumbs={[{ label: "Owner", href: "/owner/dashboard" }, { label: "Staff" }]}
        actions={
          <Button onClick={() => setAdding(true)}>
            <UserPlus aria-hidden /> Add staff
          </Button>
        }
      />

      <SectionCard title="Accounts with console access" description="Live from the platform database" bodyClassName="p-0">
        {staff.isError ? (
          <div className="p-4">
            <LiveDataState error={staff.error} onRetry={() => void staff.refetch()} />
          </div>
        ) : (
          <DataTable
            caption="Staff accounts"
            columns={columns}
            rows={staff.data ?? []}
            rowKey={(row) => row.id}
            isLoading={staff.isPending}
            minWidth="60rem"
          />
        )}
      </SectionCard>

      <p className="mt-3 text-caption text-fg-muted">
        Removing access returns the account to an ordinary learner and signs it out everywhere. Nothing they did is
        deleted — the audit log keeps their name against it.
      </p>

      <AddStaffDialog open={adding} onOpenChange={setAdding} />

      <SetPasswordDialog member={resetting} onClose={() => setResetting(null)} />

      <ConfirmDialog
        open={revoking !== null}
        onOpenChange={(open) => !open && setRevoking(null)}
        title={revoking ? `Remove ${revoking.email} from the console?` : ""}
        description="They become an ordinary learner account and are signed out of every device. You can add them again later."
        confirmLabel="Remove access"
        loading={revoke.isPending}
        onConfirm={() => {
          if (!revoking) return;
          const member = revoking;
          revoke.mutate(
            { id: member.id },
            {
              onSuccess: () => toast({ title: `${member.email} no longer has console access`, variant: "success" }),
              onError: (error) => toast({ title: "That change was refused", description: errorMessage(error), variant: "error" }),
            },
          );
          setRevoking(null);
        }}
      />
    </>
  );
}

/** A password field with the generated value visible: the owner has to be able to read it out. */
function PasswordField({
  id,
  value,
  onChange,
  onRegenerate,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  onRegenerate: () => void;
}) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>First password</Label>
      <div className="flex gap-2">
        <Input
          id={id}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="font-mono"
          autoComplete="off"
          spellCheck={false}
        />
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            void navigator.clipboard?.writeText(value).then(
              () => toast({ title: "Password copied" }),
              () => toast({ title: "Could not copy it — select and copy by hand", variant: "error" }),
            );
          }}
        >
          <Copy aria-hidden />
          <span className="sr-only">Copy password</span>
        </Button>
      </div>
      <div className="flex items-center justify-between gap-2">
        <p className={cn("text-caption", value.length < 10 ? "text-error" : "text-fg-muted")}>
          {value.length < 10 ? "At least 10 characters." : "Send this to them directly. They are asked to change it."}
        </p>
        <Button type="button" variant="ghost" size="sm" onClick={onRegenerate}>
          Generate another
        </Button>
      </div>
    </div>
  );
}

function AddStaffDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const roles = useStaffRoles();
  const add = useAddStaff();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<StaffRole>("CONTENT_MANAGER");
  const [password, setPassword] = useState(() => suggestPassword());
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setEmail("");
    setRole("CONTENT_MANAGER");
    setPassword(suggestPassword());
    setError(null);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) window.setTimeout(reset, 200);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add someone to the console</DialogTitle>
          <DialogDescription>
            They sign in with this email and password. Send the password to them directly — we do not email it.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="staff-new-email">Email</Label>
            <Input
              id="staff-new-email"
              type="email"
              value={email}
              autoComplete="off"
              placeholder="colleague@example.com"
              onChange={(event) => setEmail(event.target.value)}
            />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="staff-new-role">Role</Label>
            <NativeSelect id="staff-new-role" value={role} onChange={(event) => setRole(event.target.value as StaffRole)}>
              {(roles.data ?? []).map((option) => (
                <option key={option.role} value={option.role}>
                  {roleLabels[option.role] ?? option.role}
                </option>
              ))}
            </NativeSelect>
            <p className="text-caption text-fg-muted">
              {(roles.data ?? []).find((option) => option.role === role)?.permissions.length ?? 0} permissions. Owner is
              not on this list: there is one owner, and it is set on the server.
            </p>
          </div>

          <PasswordField
            id="staff-new-password"
            value={password}
            onChange={setPassword}
            onRegenerate={() => setPassword(suggestPassword())}
          />

          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            loading={add.isPending}
            disabled={!email.trim() || password.length < 10}
            onClick={() => {
              setError(null);
              add.mutate(
                { email: email.trim(), role, password },
                {
                  onSuccess: () => {
                    toast({ title: `${email.trim()} can now sign in`, variant: "success" });
                    onOpenChange(false);
                  },
                  onError: (err) => setError(errorMessage(err)),
                },
              );
            }}
          >
            <UserPlus aria-hidden /> Add
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SetPasswordDialog({ member, onClose }: { member: StaffMember | null; onClose: () => void }) {
  const reset = useResetStaffPassword();
  const [password, setPassword] = useState(() => suggestPassword());
  const [error, setError] = useState<string | null>(null);

  return (
    <Dialog
      open={member !== null}
      onOpenChange={(open) => {
        if (!open) {
          onClose();
          window.setTimeout(() => {
            setPassword(suggestPassword());
            setError(null);
          }, 200);
        }
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New password for {member?.email}</DialogTitle>
          <DialogDescription>
            This signs them out everywhere. Send them the new password directly.
          </DialogDescription>
        </DialogHeader>

        <PasswordField
          id="staff-reset-password"
          value={password}
          onChange={setPassword}
          onRegenerate={() => setPassword(suggestPassword())}
        />

        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            loading={reset.isPending}
            disabled={password.length < 10}
            onClick={() => {
              if (!member) return;
              setError(null);
              reset.mutate(
                { id: member.id, password },
                {
                  onSuccess: () => {
                    toast({ title: `${member.email} has a new password`, variant: "success" });
                    onClose();
                  },
                  onError: (err) => setError(errorMessage(err)),
                },
              );
            }}
          >
            Set password
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
