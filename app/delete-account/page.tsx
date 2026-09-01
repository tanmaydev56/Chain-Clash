'use client';
import Link from 'next/link';
import { useState } from 'react';

export default function DeleteAccountPage() {
  const [status, setStatus] = useState<'idle' | 'working' | 'done' | 'error'>('idle');
  async function erase() {
    const userId = window.localStorage.getItem('chain-clash-user-id');
    if (!userId) return setStatus('done');
    setStatus('working');
    try {
      const response = await fetch('/api/game', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'delete_account', userId }) });
      if (!response.ok) throw new Error();
      window.localStorage.removeItem('chain-clash-user-id'); window.localStorage.removeItem('chain-clash-name'); window.localStorage.removeItem('chain-clash-room'); setStatus('done');
    } catch { setStatus('error'); }
  }
  return <main className="mx-auto min-h-dvh max-w-3xl px-6 py-16 text-foreground"><Link href="/" className="text-primary">← Chain Clash</Link><h1 className="mt-8 text-4xl font-black">Delete account data</h1><p className="mt-6 text-muted-foreground">This permanently deletes your guest profile, leaderboard record, and game data from this device’s Chain Clash account.</p>{status === 'done' ? <p className="mt-6 font-bold text-primary">Your account data has been deleted.</p> : <button onClick={erase} disabled={status === 'working'} className="mt-6 rounded-xl bg-destructive px-5 py-3 font-black text-white">{status === 'working' ? 'Deleting…' : 'Delete my data'}</button>}{status === 'error' && <p className="mt-4 text-secondary">Could not delete data. Please try again.</p>}</main>;
}
