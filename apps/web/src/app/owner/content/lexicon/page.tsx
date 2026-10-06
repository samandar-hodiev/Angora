import { redirect } from "next/navigation";

/** Lexicon is a group in the sidebar; its first page is Vocabulary. */
export default function Page() {
  redirect("/owner/content/lexicon/vocabulary");
}
