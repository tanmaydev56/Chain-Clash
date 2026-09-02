import Link from 'next/link';

export default function HowToPlayPage() {
  return <main className="min-h-dvh bg-background px-5 py-12 text-foreground"><section className="mx-auto max-w-2xl"><Link href="/" className="text-sm font-bold text-primary">← Chain Clash</Link><h1 className="mt-8 text-4xl font-black uppercase">How to play</h1><div className="mt-7 space-y-4 text-muted-foreground"><p>Play a real word in the selected category beginning with the current letter. Your word sets the next letter. Repeats and wrong answers cost a life.</p><p>Each mode changes the server-authoritative timer, lives, and score multiplier. Fast, longer words earn more points.</p><p>Win by being the last player with lives remaining. Guests can play instantly; link Google to preserve progress across devices.</p></div></section></main>;
}
