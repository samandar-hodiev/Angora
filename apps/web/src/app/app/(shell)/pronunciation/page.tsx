import { AudioLines } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { PageHeader } from "@/components/common/page-header";
import { EmptyState } from "@/components/common/states";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = { title: "Pronunciation" };

export default function PronunciationPage() {
  return (
    <>
      <PageHeader title="Pronunciation" description="Sounds, word stress and intonation." />
      <EmptyState
        icon={AudioLines}
        title="Pronunciation drills are coming"
        description="Until then, your speaking practice already highlights words to work on."
        action={
          <Button asChild>
            <Link href="/app/speaking">Practise speaking</Link>
          </Button>
        }
      />
    </>
  );
}
