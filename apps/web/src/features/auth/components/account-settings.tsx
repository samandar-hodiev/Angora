"use client";

import { LogOut } from "lucide-react";
import { useRouter } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";

import { useLogout, useSession } from "../hooks";

export function AccountSettings() {
  const { user } = useSession();
  const logout = useLogout();
  const router = useRouter();

  if (!user) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Account</CardTitle>
        <CardDescription>The same account works on web and the Engora mobile apps.</CardDescription>
      </CardHeader>
      <CardContent>
        <dl className="grid gap-4 text-sm sm:grid-cols-[10rem_1fr]">
          <dt className="text-muted-foreground">Email</dt>
          <dd className="break-all">{user.email}</dd>
          <dt className="text-muted-foreground">Role</dt>
          <dd>
            <Badge variant="secondary">{user.role}</Badge>
          </dd>
          <dt className="text-muted-foreground">Member since</dt>
          <dd>{new Date(user.created_at).toLocaleDateString(undefined, { dateStyle: "long" })}</dd>
        </dl>
      </CardContent>
      <CardFooter className="border-t pt-6">
        <Button
          variant="outline"
          disabled={logout.isPending}
          onClick={async () => {
            await logout.mutateAsync().catch(() => undefined);
            router.replace("/login");
          }}
        >
          <LogOut aria-hidden />
          Sign out
        </Button>
      </CardFooter>
    </Card>
  );
}
