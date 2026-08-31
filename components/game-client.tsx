'use client';

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Bot, Check, Copy, Crown, Gamepad2, Globe2, Heart, LoaderCircle, RotateCcw, Send, Share2, Sparkles, Swords, Trophy, Users, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { categories, getWords, isValidWord, normalizeWord, type Category } from '@/lib/game-data';

type Player = { id: string; name: string; score: number; lives: number; joined_at: number };
type Move = { id: string; word: string; valid: number; created_at: number; player_name: string };
type RoomState = { room: { code: string; host_player_id: string; category: Category; status: 'waiting' | 'active' | 'finished'; current_letter: string; turn_player_id: string | null; winner_player_id: string | null }; players: Player[]; moves: Move[] };
type OnlineSession = { code: string; playerId: string; state: RoomState };

const playerColors = ['#d9ff64', '#ff8b72', '#70d7ff', '#c9a7ff', '#ffd05c', '#74f1b6'];
const categoryLabels: Record<Category, string> = { animals: 'Animals', food: 'Food', countries: 'Countries', things: 'Everyday things' };

function Hearts({ lives }: { lives: number }) {
  return <span className="flex gap-0.5" aria-label={`${lives} lives remaining`}>{[0, 1, 2].map((index) => <Heart key={index} className={`size-3.5 ${index < lives ? 'fill-secondary text-secondary' : 'text-white/15'}`} />)}</span>;
}

export function GameClient() {
  const [screen, setScreen] = useState<'home' | 'practice' | 'online'>('home');
  const [category, setCategory] = useState<Category>('animals');
  const [name, setName] = useState('Player');
  const [roomCode, setRoomCode] = useState('');
  const [roomDialog, setRoomDialog] = useState(false);
  const [roomTab, setRoomTab] = useState<'create' | 'join'>('create');
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState('');
  const [online, setOnline] = useState<OnlineSession | null>(null);
  const [leaderboard, setLeaderboard] = useState<Array<{ player_name: string; wins: number; best_score: number }>>([]);

  const [chain, setChain] = useState<string[]>(['tiger']);
  const [practiceWord, setPracticeWord] = useState('');
  const [practiceScore, setPracticeScore] = useState(0);
  const [botScore, setBotScore] = useState(0);
  const [practiceLives, setPracticeLives] = useState(3);
  const [botLives, setBotLives] = useState(3);
  const [turn, setTurn] = useState<'you' | 'bot'>('you');
  const [timeLeft, setTimeLeft] = useState(12);
  const [practiceStatus, setPracticeStatus] = useState<'playing' | 'won' | 'lost'>('playing');
  const [feedback, setFeedback] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const currentLetter = (chain.at(-1)?.at(-1) ?? 't').toLowerCase();

  useEffect(() => {
    const storedName = window.localStorage.getItem('chain-clash-name');
    if (storedName) setName(storedName);
    fetch('/api/game?leaderboard=1').then((response) => response.json()).then((data) => setLeaderboard(data.leaderboard ?? [])).catch(() => undefined);
  }, []);

  const resetPractice = useCallback((nextCategory = category) => {
    const starters: Record<Category, string> = { animals: 'tiger', food: 'taco', countries: 'india', things: 'table' };
    setCategory(nextCategory); setChain([starters[nextCategory]]); setPracticeScore(0); setBotScore(0); setPracticeLives(3); setBotLives(3); setTurn('you'); setTimeLeft(12); setPracticeStatus('playing'); setPracticeWord(''); setFeedback(''); setScreen('practice');
    setTimeout(() => inputRef.current?.focus(), 80);
  }, [category]);

  const losePracticeLife = useCallback((message: string) => {
    setFeedback(message);
    setPracticeLives((lives) => {
      const next = lives - 1;
      if (next <= 0) setPracticeStatus('lost');
      return Math.max(0, next);
    });
    setTimeLeft(12);
  }, []);

  const botMove = useCallback((nextLetter: string, usedChain: string[]) => {
    setTimeout(() => {
      const options = getWords(category, nextLetter, usedChain);
      if (!options.length || Math.random() < 0.12) {
        setBotLives((lives) => {
          const next = lives - 1;
          if (next <= 0) setPracticeStatus('won');
          return Math.max(0, next);
        });
        setFeedback('WordBot stumbled. Your turn!');
        setTurn('you'); setTimeLeft(12);
        return;
      }
      const word = options[Math.floor(Math.random() * options.length)];
      setChain((value) => [...value, word]); setBotScore((score) => score + word.length * 10); setFeedback(`WordBot played “${word}”`); setTurn('you'); setTimeLeft(12);
      setTimeout(() => inputRef.current?.focus(), 80);
    }, 850);
  }, [category]);

  const submitPractice = useCallback(() => {
    if (practiceStatus !== 'playing' || turn !== 'you') return;
    const word = normalizeWord(practiceWord);
    if (!word.startsWith(currentLetter)) return losePracticeLife(`Start with “${currentLetter.toUpperCase()}”`);
    if (chain.includes(word)) return losePracticeLife('That word was already used');
    if (!isValidWord(category, word)) return losePracticeLife(`“${practiceWord || 'That'}” is not in this category`);
    const nextChain = [...chain, word];
    setChain(nextChain); setPracticeScore((score) => score + word.length * 10 + Math.ceil(timeLeft) * 2); setPracticeWord(''); setFeedback(`Nice! +${word.length * 10 + Math.ceil(timeLeft) * 2}`); setTurn('bot');
    botMove(word.at(-1) ?? 'a', nextChain);
  }, [botMove, category, chain, currentLetter, losePracticeLife, practiceStatus, practiceWord, timeLeft, turn]);

  useEffect(() => {
    if (screen !== 'practice' || practiceStatus !== 'playing' || turn !== 'you') return;
    const timer = window.setInterval(() => setTimeLeft((value) => {
      if (value <= 0.1) { window.clearInterval(timer); losePracticeLife('Time ran out'); return 12; }
      return Math.max(0, value - 0.1);
    }), 100);
    return () => window.clearInterval(timer);
  }, [losePracticeLife, practiceStatus, screen, turn]);

  const refreshRoom = useCallback(async () => {
    if (!online?.code) return;
    const response = await fetch(`/api/game?code=${encodeURIComponent(online.code)}`, { cache: 'no-store' });
    if (response.ok) {
      const state = await response.json() as RoomState;
      setOnline((session) => session ? { ...session, state } : null);
    }
  }, [online?.code]);

  useEffect(() => {
    if (screen !== 'online' || !online) return;
    const timer = window.setInterval(refreshRoom, 1200);
    return () => window.clearInterval(timer);
  }, [online, refreshRoom, screen]);

  async function roomAction(action: 'create' | 'join') {
    setLoading(true); setNotice('');
    window.localStorage.setItem('chain-clash-name', name);
    try {
      const response = await fetch('/api/game', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, name, category, code: roomCode }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? 'Could not open the room.');
      setOnline({ code: data.code, playerId: data.playerId, state: data.state }); setRoomDialog(false); setScreen('online');
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Could not open the room.'); }
    finally { setLoading(false); }
  }

  async function submitOnline(word: string) {
    if (!online) return;
    setLoading(true); setNotice('');
    try {
      const response = await fetch('/api/game', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'submit', code: online.code, playerId: online.playerId, word }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? 'Move rejected.');
      setOnline({ ...online, state: data.state });
      setNotice(data.valid ? 'Great chain!' : 'Invalid word — one life lost.');
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Move rejected.'); }
    finally { setLoading(false); }
  }

  if (screen === 'practice') return <PracticeGame category={category} chain={chain} currentLetter={currentLetter} word={practiceWord} setWord={setPracticeWord} submit={submitPractice} score={practiceScore} botScore={botScore} lives={practiceLives} botLives={botLives} turn={turn} timeLeft={timeLeft} status={practiceStatus} feedback={feedback} inputRef={inputRef} back={() => setScreen('home')} replay={() => resetPractice(category)} />;
  if (screen === 'online' && online) return <OnlineGame session={online} name={name} notice={notice} loading={loading} submit={submitOnline} refresh={refreshRoom} leave={() => { setOnline(null); setScreen('home'); }} />;

  return (
    <main className="min-h-dvh overflow-hidden bg-background text-foreground">
      <div className="noise" />
      <header className="relative z-10 mx-auto flex w-full max-w-7xl items-center justify-between px-5 py-5 sm:px-8">
        <div className="flex items-center gap-3"><Logo /><span className="text-lg font-black uppercase tracking-[-0.04em]">Chain Clash</span></div>
        <span className="hidden items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-muted-foreground sm:flex"><Globe2 className="size-3.5 text-primary" /> Live multiplayer</span>
      </header>
      <section className="relative z-10 mx-auto grid w-full max-w-7xl gap-10 px-5 pb-12 pt-7 lg:grid-cols-[0.82fr_1.18fr] lg:items-center lg:px-8 lg:pt-12">
        <div className="max-w-xl">
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-primary/25 bg-primary/10 px-3 py-1.5 text-xs font-extrabold uppercase tracking-[0.14em] text-primary"><span className="size-1.5 animate-pulse rounded-full bg-primary" />Fast words. Faster wins.</div>
          <h1 className="text-balance text-[clamp(3.4rem,9vw,7rem)] font-black uppercase leading-[0.82] tracking-[-0.075em]">Think fast.<span className="block text-primary">Chain faster.</span></h1>
          <p className="mt-7 max-w-lg text-pretty text-base leading-7 text-muted-foreground sm:text-lg">Battle friends and rivals in rapid-fire word chains. One wrong letter and the crown is gone.</p>
          <div className="mt-8 grid gap-3 sm:grid-cols-2">
            <Button onClick={() => resetPractice(category)} className="h-14 rounded-xl bg-primary px-6 text-base font-black uppercase text-primary-foreground shadow-[0_6px_0_#6f841e] transition hover:-translate-y-0.5 hover:bg-primary active:translate-y-1 active:shadow-none"><Gamepad2 className="size-5" /> Play now <ArrowRight className="ml-auto size-5" /></Button>
            <Button onClick={() => { setRoomTab('create'); setRoomDialog(true); }} variant="outline" className="h-14 rounded-xl border-white/15 bg-white/5 px-6 text-base font-black uppercase hover:bg-white/10"><Users className="size-5 text-secondary" /> Online room</Button>
          </div>
          <div className="mt-5 flex flex-wrap gap-2">{(Object.keys(categories) as Category[]).map((item) => <button key={item} onClick={() => setCategory(item)} className={`rounded-full border px-3 py-1.5 text-xs font-bold transition ${category === item ? 'border-primary/40 bg-primary/12 text-primary' : 'border-white/10 bg-white/[0.03] text-muted-foreground hover:text-white'}`}>{categoryLabels[item]}</button>)}</div>
        </div>
        <GamePreview />
      </section>

      <section className="relative z-10 mx-auto grid w-full max-w-7xl gap-4 px-5 pb-16 sm:grid-cols-3 sm:px-8">
        {[['01', 'Pick a category', 'Animals, food, countries and everyday things.'], ['02', 'Chain the word', 'Your answer starts with the last letter played.'], ['03', 'Outlast rivals', 'Three lives. Twelve seconds. No repeats.']].map(([number, title, copy]) => <div key={number} className="rounded-2xl border border-white/8 bg-white/[0.025] p-5"><span className="font-mono text-xs font-black text-primary">{number}</span><h2 className="mt-4 text-lg font-black uppercase">{title}</h2><p className="mt-2 text-sm leading-6 text-muted-foreground">{copy}</p></div>)}
      </section>

      {leaderboard.length > 0 && <section className="relative z-10 mx-auto w-full max-w-7xl px-5 pb-16 sm:px-8"><div className="rounded-2xl border border-white/8 bg-white/[0.025] p-5"><div className="flex items-center gap-2"><Trophy className="size-5 text-primary" /><h2 className="font-black uppercase">Weekly champions</h2></div><div className="mt-4 grid gap-2 sm:grid-cols-3">{leaderboard.slice(0, 3).map((row, index) => <div key={row.player_name} className="flex items-center gap-3 rounded-xl bg-black/20 p-3"><span className="grid size-8 place-items-center rounded-lg bg-primary/10 font-mono text-xs font-black text-primary">#{index + 1}</span><span className="font-bold">{row.player_name}</span><span className="ml-auto text-xs text-muted-foreground">{row.wins} wins</span></div>)}</div></div></section>}

      {roomDialog && <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4 backdrop-blur-sm" onMouseDown={(event) => { if (event.target === event.currentTarget) setRoomDialog(false); }}><section role="dialog" aria-modal="true" aria-labelledby="room-title" className="relative w-full max-w-md rounded-2xl border border-white/10 bg-[#171b22] p-5 shadow-2xl"><Button onClick={() => setRoomDialog(false)} variant="ghost" size="icon-sm" className="absolute right-3 top-3"><X /></Button><h2 id="room-title" className="text-2xl font-black uppercase tracking-tight">Play online</h2><p className="mt-2 text-sm text-muted-foreground">Create a private room or join your friends with a six-character code.</p><div className="mt-5 grid grid-cols-2 gap-2 rounded-xl bg-black/20 p-1">{(['create', 'join'] as const).map((tab) => <button key={tab} onClick={() => { setRoomTab(tab); setNotice(''); }} className={`rounded-lg px-3 py-2 text-sm font-black uppercase ${roomTab === tab ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'}`}>{tab}</button>)}</div><div className="mt-5 space-y-4"><label className="block text-xs font-bold uppercase tracking-wider text-muted-foreground">Your name<Input value={name} onChange={(event) => setName(event.target.value)} maxLength={16} className="mt-2 h-12 border-white/12 bg-white/5 text-base" /></label>{roomTab === 'join' && <label className="block text-xs font-bold uppercase tracking-wider text-muted-foreground">Room code<Input value={roomCode} onChange={(event) => setRoomCode(event.target.value.toUpperCase())} maxLength={6} placeholder="ABC123" className="mt-2 h-12 border-white/12 bg-white/5 font-mono text-lg font-black uppercase tracking-[0.2em]" /></label>}{roomTab === 'create' && <div><p className="mb-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">Category</p><div className="grid grid-cols-2 gap-2">{(Object.keys(categories) as Category[]).map((item) => <button key={item} onClick={() => setCategory(item)} className={`rounded-xl border p-3 text-left text-sm font-bold ${category === item ? 'border-primary/50 bg-primary/10 text-primary' : 'border-white/10 bg-white/[0.03]'}`}>{categoryLabels[item]}</button>)}</div></div>}{notice && <p className="rounded-lg bg-secondary/10 p-3 text-sm font-semibold text-secondary">{notice}</p>}<Button disabled={loading || (roomTab === 'join' && roomCode.length !== 6)} onClick={() => roomAction(roomTab)} className="h-12 w-full rounded-xl bg-primary font-black uppercase text-primary-foreground hover:bg-primary">{loading ? <LoaderCircle className="animate-spin" /> : roomTab === 'create' ? <><Sparkles /> Create room</> : <><Send /> Join match</>}</Button></div></section></div>}
    </main>
  );
}

function Logo() { return <span className="grid size-10 place-items-center rounded-xl bg-primary text-primary-foreground shadow-[0_6px_0_#6f841e]"><Swords className="size-5" strokeWidth={2.8} /></span>; }

function GamePreview() {
  const previewPlayers = [{ name: 'You', score: 420 }, { name: 'Mira', score: 380 }, { name: 'WordBot', score: 260 }];
  return <div className="game-shell relative mx-auto w-full max-w-2xl rounded-[2rem] border border-white/12 bg-[#161a21]/90 p-3 shadow-[0_30px_90px_rgba(0,0,0,.45)] sm:p-5"><div className="absolute -right-10 -top-12 -z-10 size-44 rounded-full bg-secondary/20 blur-3xl" /><div className="flex items-center justify-between px-2 pb-4 pt-1"><div><p className="micro-label">Category</p><p className="mt-1 text-sm font-black uppercase">Animals</p></div><span className="rounded-full bg-white/5 px-3 py-1.5 text-xs font-bold"><span className="text-primary">Round 3</span> / 5</span><div className="text-right"><p className="micro-label">Time</p><p className="mt-1 font-mono text-lg font-black text-secondary">08.4</p></div></div><div className="relative overflow-hidden rounded-[1.4rem] border border-white/10 bg-[#0e1116] px-4 py-7 sm:px-8 sm:py-10"><div className="absolute inset-x-0 top-0 h-1 bg-white/5"><div className="h-full w-[58%] bg-secondary" /></div><div className="mb-7 flex items-center justify-center gap-2 text-sm font-black uppercase sm:gap-3 sm:text-base"><span className="word-chip">Tiger</span><ArrowRight className="size-4 text-white/25" /><span className="word-chip">Rabbit</span><ArrowRight className="size-4 text-white/25" /><span className="rounded-lg border border-primary/30 bg-primary/10 px-3 py-2 text-primary">?</span></div><div className="mx-auto max-w-md text-center"><p className="micro-label">Your word must start with</p><div className="letter-prompt">T</div><div className="flex h-14 items-center rounded-xl border border-primary/30 bg-white/[0.04] px-4 text-left font-bold text-white/30 ring-4 ring-primary/5">Type an animal…<span className="ml-auto rounded-lg bg-primary px-3 py-2 text-xs font-black uppercase text-primary-foreground">Enter</span></div></div></div><div className="mt-3 grid grid-cols-3 gap-2">{previewPlayers.map((player, index) => <div key={player.name} className={`rounded-xl border p-3 ${index === 0 ? 'border-primary/30 bg-primary/8' : 'border-white/8 bg-white/[0.03]'}`}><div className="flex items-center gap-2"><span className="grid size-8 place-items-center rounded-lg text-xs font-black text-[#101318]" style={{ backgroundColor: playerColors[index] }}>{player.name[0]}</span><div className="min-w-0"><p className="truncate text-xs font-extrabold">{player.name}</p><p className="font-mono text-[10px] text-muted-foreground">{player.score} pts</p></div>{index === 0 && <Crown className="ml-auto size-4 fill-primary text-primary" />}</div></div>)}</div></div>;
}

type PracticeProps = { category: Category; chain: string[]; currentLetter: string; word: string; setWord: (word: string) => void; submit: () => void; score: number; botScore: number; lives: number; botLives: number; turn: 'you' | 'bot'; timeLeft: number; status: 'playing' | 'won' | 'lost'; feedback: string; inputRef: React.RefObject<HTMLInputElement | null>; back: () => void; replay: () => void };
function PracticeGame(props: PracticeProps) {
  return <GameFrame title="Practice match" category={categoryLabels[props.category]} back={props.back}><div className="mx-auto w-full max-w-3xl"><div className="mb-4 grid grid-cols-2 gap-3"><PlayerCard name="You" score={props.score} lives={props.lives} active={props.turn === 'you'} color={playerColors[0]} /><PlayerCard name="WordBot" score={props.botScore} lives={props.botLives} active={props.turn === 'bot'} color={playerColors[2]} bot /></div><div className="relative overflow-hidden rounded-[1.75rem] border border-white/10 bg-[#0e1116] p-5 shadow-2xl sm:p-9"><div className="absolute inset-x-0 top-0 h-1 bg-white/5"><div className="h-full bg-secondary transition-all" style={{ width: `${props.timeLeft / 12 * 100}%` }} /></div><div className="flex items-center justify-between"><span className="rounded-full bg-white/5 px-3 py-1.5 text-xs font-bold">{props.turn === 'you' ? 'Your turn' : 'WordBot is thinking…'}</span><span className="font-mono text-lg font-black text-secondary">{props.timeLeft.toFixed(1)}s</span></div><div className="mt-8 flex min-h-12 flex-wrap items-center justify-center gap-2">{props.chain.slice(-5).map((item, index) => <span key={`${item}-${index}`} className="word-chip capitalize">{item}</span>)}</div>{props.status === 'playing' ? <div className="mx-auto mt-8 max-w-lg text-center"><p className="micro-label">Play a {categoryLabels[props.category].toLowerCase()} word starting with</p><div className="letter-prompt">{props.currentLetter}</div><form onSubmit={(event) => { event.preventDefault(); props.submit(); }} className="flex gap-2"><Input ref={props.inputRef} value={props.word} disabled={props.turn !== 'you'} onChange={(event) => props.setWord(event.target.value)} placeholder={`${props.currentLetter.toUpperCase()}…`} autoComplete="off" className="h-14 border-primary/30 bg-white/[0.04] px-4 text-lg font-bold focus-visible:ring-primary/20" /><Button type="submit" disabled={props.turn !== 'you' || !props.word.trim()} className="h-14 w-14 rounded-xl bg-primary text-primary-foreground hover:bg-primary" size="icon"><Send className="size-5" /></Button></form><p className="mt-3 min-h-5 text-sm font-semibold text-muted-foreground">{props.feedback || 'No repeats. Only letters count.'}</p></div> : <div className="mx-auto mt-10 max-w-md text-center">{props.status === 'won' ? <Trophy className="mx-auto size-14 text-primary" /> : <X className="mx-auto size-14 text-secondary" />}<h2 className="mt-4 text-4xl font-black uppercase">{props.status === 'won' ? 'You win!' : 'Game over'}</h2><p className="mt-2 text-muted-foreground">Final score: {props.score} points</p><Button onClick={props.replay} className="mt-6 h-12 rounded-xl bg-primary px-6 font-black uppercase text-primary-foreground hover:bg-primary"><RotateCcw /> Play again</Button></div>}</div></div></GameFrame>;
}

function OnlineGame({ session, name, notice, loading, submit, refresh, leave }: { session: OnlineSession; name: string; notice: string; loading: boolean; submit: (word: string) => void; refresh: () => void; leave: () => void }) {
  const [word, setWord] = useState(''); const [copied, setCopied] = useState(false); const { room, players, moves } = session.state; const me = players.find((player) => player.id === session.playerId); const activePlayer = players.find((player) => player.id === room.turn_player_id); const winner = players.find((player) => player.id === room.winner_player_id); const isTurn = room.turn_player_id === session.playerId;
  const share = async () => { const text = `Join my Chain Clash room: ${room.code}`; const url = `${window.location.origin}?room=${room.code}`; if (navigator.share) await navigator.share({ title: 'Chain Clash', text, url }); else await navigator.clipboard.writeText(`${text} ${url}`); setCopied(true); setTimeout(() => setCopied(false), 1600); };
  return <GameFrame title={`Room ${room.code}`} category={categoryLabels[room.category]} back={leave} action={<Button onClick={share} variant="outline" className="border-white/10 bg-white/5"><Share2 /> {copied ? 'Copied' : 'Invite'}</Button>}><div className="mx-auto w-full max-w-4xl"><div className="mb-4 flex gap-3 overflow-x-auto pb-1">{players.map((player, index) => <div key={player.id} className="min-w-[170px] flex-1"><PlayerCard name={player.id === session.playerId ? `${player.name} (you)` : player.name} score={player.score} lives={player.lives} active={player.id === room.turn_player_id} color={playerColors[index % playerColors.length]} /></div>)}</div><div className="relative overflow-hidden rounded-[1.75rem] border border-white/10 bg-[#0e1116] p-5 shadow-2xl sm:p-9">{room.status === 'waiting' ? <div className="py-16 text-center"><Users className="mx-auto size-14 text-primary" /><h2 className="mt-5 text-3xl font-black uppercase">Waiting for a rival</h2><p className="mt-2 text-muted-foreground">Share this code with a friend. The match starts when they join.</p><button onClick={share} className="mx-auto mt-6 flex items-center gap-3 rounded-2xl border border-primary/30 bg-primary/10 px-6 py-4 font-mono text-3xl font-black tracking-[0.2em] text-primary">{room.code}{copied ? <Check className="size-5" /> : <Copy className="size-5" />}</button><Button onClick={refresh} variant="ghost" className="mt-4 text-muted-foreground"><RotateCcw /> Check room</Button></div> : room.status === 'finished' ? <div className="py-16 text-center"><Crown className="mx-auto size-16 fill-primary text-primary" /><h2 className="mt-5 text-4xl font-black uppercase">{winner?.name ?? 'Winner'} wins!</h2><p className="mt-2 text-muted-foreground">The final chain had {moves.filter((move) => move.valid).length} accepted words.</p></div> : <><div className="flex items-center justify-between"><span className="rounded-full bg-white/5 px-3 py-1.5 text-xs font-bold">{isTurn ? 'Your turn' : `${activePlayer?.name ?? 'Player'} is thinking…`}</span><span className="flex items-center gap-2 text-xs font-bold text-primary"><span className="size-2 animate-pulse rounded-full bg-primary" /> Live</span></div><div className="mt-8 flex min-h-12 flex-wrap items-center justify-center gap-2">{moves.slice().reverse().filter((move) => move.valid).slice(-5).map((move) => <span key={move.id} className="word-chip capitalize">{move.word}</span>)}</div><div className="mx-auto mt-8 max-w-lg text-center"><p className="micro-label">Play a {categoryLabels[room.category].toLowerCase()} word starting with</p><div className="letter-prompt">{room.current_letter}</div><form onSubmit={(event) => { event.preventDefault(); if (word.trim()) { submit(word); setWord(''); } }} className="flex gap-2"><Input value={word} disabled={!isTurn || loading} onChange={(event) => setWord(event.target.value)} placeholder={`${room.current_letter.toUpperCase()}…`} className="h-14 border-primary/30 bg-white/[0.04] px-4 text-lg font-bold" /><Button type="submit" disabled={!isTurn || loading || !word.trim()} className="h-14 w-14 rounded-xl bg-primary text-primary-foreground hover:bg-primary" size="icon">{loading ? <LoaderCircle className="animate-spin" /> : <Send />}</Button></form><p className="mt-3 min-h-5 text-sm font-semibold text-muted-foreground">{notice || (isTurn ? `Go, ${name}!` : 'Room updates automatically.')}</p></div></>}</div></div></GameFrame>;
}

function PlayerCard({ name, score, lives, active, color, bot = false }: { name: string; score: number; lives: number; active: boolean; color: string; bot?: boolean }) { return <div className={`rounded-xl border p-3 transition ${active ? 'border-primary/40 bg-primary/8 shadow-[0_0_25px_rgba(217,255,100,.08)]' : 'border-white/8 bg-white/[0.03]'}`}><div className="flex items-center gap-3"><span className="grid size-10 place-items-center rounded-lg text-sm font-black text-[#101318]" style={{ backgroundColor: color }}>{bot ? <Bot className="size-5" /> : name[0]?.toUpperCase()}</span><div className="min-w-0"><p className="truncate text-sm font-extrabold">{name}</p><p className="font-mono text-[11px] text-muted-foreground">{score} pts</p></div><span className="ml-auto"><Hearts lives={lives} /></span></div></div>; }

function GameFrame({ title, category, back, action, children }: { title: string; category: string; back: () => void; action?: React.ReactNode; children: React.ReactNode }) { return <main className="min-h-dvh bg-background text-foreground"><div className="noise" /><header className="relative z-10 mx-auto flex w-full max-w-6xl items-center gap-3 px-4 py-5 sm:px-8"><Button onClick={back} variant="ghost" size="icon-lg" className="rounded-xl hover:bg-white/8"><ArrowLeft /></Button><Logo /><div><p className="text-sm font-black uppercase">{title}</p><p className="text-xs text-muted-foreground">{category}</p></div><div className="ml-auto">{action}</div></header><section className="relative z-10 px-4 pb-10 pt-2 sm:px-8">{children}</section></main>; }
