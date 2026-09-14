import { ArrowRight, AudioLines, BrainCircuit, ChartLine, MessageSquareText, Target } from "lucide-react";
import Link from "next/link";

import { Brand } from "@/components/common/brand";
import { Button } from "@/components/ui/button";
import { ApiStatus } from "@/features/system/api-status";

const loop = [
  { icon: AudioLines, title: "Practice", text: "Speak, write, read and listen on real topics at your level." },
  { icon: BrainCircuit, title: "AI analysis", text: "Every answer is analysed for grammar, vocabulary, fluency and more." },
  { icon: MessageSquareText, title: "Feedback", text: "Clear corrections and explanations, not just a score." },
  { icon: Target, title: "Personal practice", text: "Your recurring mistakes become your next exercises." },
  { icon: ChartLine, title: "Progress", text: "See each skill improve over time, on web and mobile." },
];

export default function HomePage() {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-4 sm:px-6">
        <Brand />
        <nav aria-label="Account" className="flex items-center gap-2">
          <Button variant="ghost" asChild>
            <Link href="/login">Log in</Link>
          </Button>
          <Button asChild>
            <Link href="/register">Start learning</Link>
          </Button>
        </nav>
      </header>

      <main id="main" className="flex-1">
        <section className="mx-auto grid max-w-6xl gap-6 px-4 pt-16 pb-20 sm:px-6 sm:pt-24">
          <p className="text-sm font-medium text-primary">Your AI English Coach</p>
          <h1 className="max-w-3xl text-4xl font-semibold tracking-tight text-balance sm:text-6xl">
            Your English. Your AI Coach.
          </h1>
          <p className="max-w-2xl text-lg text-pretty text-muted-foreground">
            Practice speaking, writing, reading and listening with AI feedback that adapts to what you need to improve.
          </p>
          <div className="flex flex-wrap gap-3 pt-2">
            <Button size="lg" asChild>
              <Link href="/register">
                Start learning <ArrowRight aria-hidden />
              </Link>
            </Button>
            <Button size="lg" variant="outline" asChild>
              <a href="#how-it-works">See how it works</a>
            </Button>
          </div>
        </section>

        <section id="how-it-works" aria-labelledby="how-title" className="border-t bg-card/50">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
            <h2 id="how-title" className="text-2xl font-semibold tracking-tight">
              How Engora works
            </h2>
            <ol className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
              {loop.map((step, index) => (
                <li key={step.title} className="rounded-xl border bg-card p-5">
                  <div className="flex items-center justify-between">
                    <step.icon className="size-5 text-primary" aria-hidden />
                    <span className="text-xs text-muted-foreground tabular-nums">0{index + 1}</span>
                  </div>
                  <h3 className="mt-4 font-medium">{step.title}</h3>
                  <p className="mt-1 text-sm text-muted-foreground">{step.text}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>
      </main>

      <footer className="border-t">
        <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-6 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <span>© {new Date().getFullYear()} Engora</span>
          <ApiStatus />
        </div>
      </footer>
    </div>
  );
}
