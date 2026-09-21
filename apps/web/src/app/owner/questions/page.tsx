import type { Metadata } from "next";

import { QuestionBankView } from "@/features/owner/views/question-bank-view";

export const metadata: Metadata = { title: "Question bank" };

export default function OwnerQuestionBankPage() {
  return <QuestionBankView />;
}
