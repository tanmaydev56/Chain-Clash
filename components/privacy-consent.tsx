'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';

export function PrivacyConsent() {
  const [visible, setVisible] = useState(() => typeof window !== 'undefined' && !window.localStorage.getItem('chain-clash-consent'));
  if (!visible) return null;
  const choose = (value: 'essential' | 'all') => { window.localStorage.setItem('chain-clash-consent', value); setVisible(false); };
  return <aside className="fixed inset-x-3 bottom-3 z-[60] mx-auto max-w-xl rounded-2xl border border-white/12 bg-[#171b22]/95 p-4 shadow-2xl backdrop-blur" aria-label="Privacy choices"><p className="text-sm font-bold">Your privacy choices</p><p className="mt-1 text-xs leading-5 text-muted-foreground">We use essential storage for your guest profile and match recovery. Optional analytics or ads are disabled until you choose to allow them.</p><div className="mt-3 flex flex-wrap items-center gap-2"><Button onClick={() => choose('essential')} variant="outline" className="border-white/15 bg-transparent text-xs font-bold">Essential only</Button><Button onClick={() => choose('all')} className="bg-primary text-xs font-black text-primary-foreground hover:bg-primary">Allow optional</Button><Link href="/privacy" className="ml-auto text-xs font-bold text-primary underline">Privacy policy</Link></div></aside>;
}
