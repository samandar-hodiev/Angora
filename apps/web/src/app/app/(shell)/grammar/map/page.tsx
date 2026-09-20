import type { Metadata } from "next";

import { GrammarMapView } from "@/features/grammar/components/map-view";

export const metadata: Metadata = {
  title: "Grammar map",
  description: "The whole grammar curriculum and where you are in it.",
};

export default function Page() {
  return <GrammarMapView />;
}
