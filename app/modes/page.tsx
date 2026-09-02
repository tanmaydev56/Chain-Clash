'use client';
/* oxlint-disable next/no-html-link-for-pages -- Vinext RSC client navigation is unreliable in production; document navigation is the reliable fallback. */


import { gameModes, modeOrder } from '@/lib/game-modes';

export default function ModesPage() {
  return <main className="min-h-dvh bg-background px-5 py-12 text-foreground"><section className="mx-auto max-w-3xl"><a href="/" className="text-sm font-bold text-primary">← Chain Clash</a><h1 className="mt-8 text-4xl font-black uppercase">Choose your clash.</h1><div className="mt-7 grid gap-3 sm:grid-cols-2">{modeOrder.map((id) => { const mode = gameModes[id]; return <article key={id} className="rounded-2xl border border-white/10 bg-white/[0.03] p-5"><h2 className="font-black uppercase text-primary">{mode.name}</h2><p className="mt-2 text-sm text-muted-foreground">{mode.tagline}</p><p className="mt-4 font-mono text-xs text-white/70">{mode.turnSeconds}s · {mode.lives} lives · ×{mode.scoreMultiplier} score</p><a href="/" className="mt-5 inline-block text-sm font-bold text-primary underline">Play this mode on Home</a></article>; })}</div></section></main>;
}
