'use client';

import Link from 'next/link';

export default function SignInPage() {
  return <main className="min-h-dvh bg-background px-5 py-12 text-foreground"><section className="mx-auto max-w-lg rounded-3xl border border-white/10 bg-white/[0.03] p-7"><Link href="/" className="text-sm font-bold text-primary">← Chain Clash</Link><h1 className="mt-8 text-4xl font-black uppercase">Save your streak.</h1><p className="mt-3 leading-7 text-muted-foreground">Play instantly as a guest, or link Google to recover your XP, MMR, coins, and match history on another device.</p><Link href="/api/auth/google" className="mt-7 block rounded-xl bg-primary px-5 py-4 text-center font-black uppercase text-primary-foreground">Continue with Google</Link><Link href="/" className="mt-4 block text-center text-sm font-bold text-muted-foreground underline">Keep playing as guest</Link></section></main>;
}
