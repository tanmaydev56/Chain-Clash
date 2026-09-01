# Chain Clash — Engineering Brief for Codex

**Audience:** the AI agent (Codex) building and scaling Chain Clash.
**Goal:** take this from a working demo to a game **real strangers play daily and that earns money**, without breaking as it scales.
**Read this whole file before writing code.** It encodes decisions, invariants, and edge cases you must not rediscover the hard way.

> Companion docs: `CHAIN-CLASH-ROADMAP.md` (the *what* and *why*, priority-ordered). This file is the *how* — architecture, testing, deployment, edge cases.

---

## 0. How to use this brief

- Work **one feature at a time**, top of the roadmap first. Do not start Phase 2 work while Phase 0 bugs exist.
- Every change ships with **tests** and passes the **Definition of Done** (§14).
- When a decision isn't covered here, prefer: **server authority, fail safe, cache aggressively, never trust the client.**
- If you change an architectural invariant in §3, update this file in the same PR.

---

## 1. The stack — facts you must not get wrong

| Layer | Reality | Implication |
| --- | --- | --- |
| Framework | **vinext** (Vite-based, Next-like RSC) — *not* Next.js/Expo/React Native | No `next dev`. Use `npm run dev` (`vinext dev`). App Router-style `app/` routes and `route.ts` handlers work. |
| Runtime | **Cloudflare Workers** (edge, V8 isolates) | No Node APIs at runtime. No filesystem. No long-lived memory between requests. Use Web APIs (`fetch`, `crypto`, `AbortController`). |
| DB | **Cloudflare D1** (SQLite at the edge) via raw `db.prepare(...)` and Drizzle | D1 is great for durable, low-frequency writes. It is **not** a real-time pub/sub. High-frequency per-room writes need Durable Objects (§5.1). |
| Hosting | **OpenAI Sites** (`.openai/hosting.json`, `*.chatgpt.site`) | The control plane injects the `DB` binding. Secrets (e.g. `OPENAI_API_KEY`) are set through the hosting platform's secret mechanism or `wrangler secret put` when self-hosting. |
| Client | **React 19**, Tailwind v4, shadcn-style UI in `components/ui/*` | Game logic lives in `components/game-client.tsx` (client component). Online state is fetched by **polling** today. |
| Lint/format | **oxlint** (`npm run lint`), **oxfmt** (`npm run format`) | oxlint runs the TS type-checker too. It is strict (`no-base-to-string`, `no-explicit-any`). |
| Tests | **node:test** (`npm test` → `node --test tests/*.test.ts`) | Node's native TS + test runner. **Relative imports need explicit `.ts` extensions** (e.g. `../lib/game-data.ts`). |

**Do not** introduce Next.js, Expo, Supabase, Prisma, or a Node server. They do not fit this runtime. If you think you need them, you've misread the stack.

---

## 2. Repo map

```
app/
  layout.tsx            # <head>, OG/Twitter metadata, fonts
  page.tsx              # renders <GameClient/>
  globals.css           # theme tokens + game styles
  api/game/route.ts     # THE backend. GET (state/leaderboard) + POST (create/join/quick/add_bot/submit)
components/
  game-client.tsx       # ALL game UI + client state (home / practice / online screens)
  ui/*                  # shadcn-style primitives — do not hand-edit unless necessary
db/
  schema.ts             # Drizzle schema (⚠ DRIFTED — see §5.6; game-db.ts DDL is the live truth)
  index.ts              # drizzle(env.DB)
  env.d.ts              # Cloudflare.Env typing (DB, OPENAI_API_KEY)
lib/
  game-data.ts          # categories (seed word lists), normalize/validate/blocklist helpers
  game-db.ts            # getGameDb(): opens D1, runs CREATE TABLE IF NOT EXISTS + ALTERs (auto-migrate)
  word-validation.ts    # layered validator (pre-check → seed → cache → AI → fallback)  ← NEW
tests/
  game-data.test.ts
  word-validation.test.ts   ← NEW
```

**Backend surface is one file:** `app/api/game/route.ts`. It is currently a request/response handler with the server as the authority for online moves (good). As it grows, split it (§5.1) but keep server authority.

---

## 3. Golden rules (invariants)

1. **The server is the single source of truth for anything that affects score, lives, turn order, currency, or purchases.** The client may *predict* for responsiveness but the server decides. Never accept a client-sent score/valid flag.
2. **Validate every input at the boundary.** Coerce with helpers (`cleanName`, `normalizeWord`, `stableUserId`), bound lengths, whitelist enums (category, action). Reject early with a clear error + status code.
3. **Fail safe, not open** on money/score. Fail *soft* on pure UX (e.g. an AI timeout during a match — see the `fallbackAccept` decision in §4).
4. **Idempotency & concurrency:** two requests for the same room can race. Guard turn changes with the turn owner + a monotonic check (deadline / version). Never let a double-submit take two turns.
5. **Everything user-generated is untrusted and public-facing:** words, names, chat. Filter (blocklist), rate-limit, and make it reportable.
6. **Cost is a feature.** Each design choice should minimize D1 reads/writes and AI calls. Cache verdicts; poll less; hibernate sockets.
7. **No secrets in the client bundle.** `OPENAI_API_KEY` and any provider keys are server-only (Worker secrets). The client never calls OpenAI directly.

---

## 4. Feature 1 — Real word validation (STATUS: implemented, extend it)

### What the bug was
The entire dictionary was ~300 hardcoded words in `lib/game-data.ts`. A player answering with any real word you didn't list (`rhinoceros`, `alligator`, `chimpanzee`) **lost a life for being right.** Codex had earlier added a `word_cache` table and a `validateWord()` seam, but it only ever stored `'curated'` verdicts — it never expanded the dictionary or called AI, so the bug remained.

### What is now in place (`lib/word-validation.ts`)
A cheapest-first cascade, so you almost never pay for AI:

1. **Pre-checks** (pure, instant): well-formed (`^[a-z]{2,32}$`) and not a slur (`blockedWords`).
2. **Seed list** (pure, instant): the curated `categories` in `game-data.ts` — now expanded to ~180 animals, ~170 foods, ~155 countries, ~180 things so the common cases pass with zero I/O.
3. **`word_cache`** (one indexed D1 read): verdicts seen before (`accepted`/`rejected`).
4. **AI judge** (one network call, then cached forever): asks a model "Is *word* a real {category}?" and writes the verdict back to `word_cache`.

It is wired into `app/api/game/route.ts` → `validateWord()`. Tests: `tests/word-validation.test.ts` (pre-check, seed, cache hit/miss, AI yes/no, cache write-back, AI failure fallback). Run `npm test`.

### What YOU (Codex) must still do

1. **Turn on the AI layer.** Set the Worker secret so unknown words get judged:
   ```bash
   wrangler secret put OPENAI_API_KEY
   ```
   (or set it in the OpenAI Sites hosting secret settings). Without it, only seed words pass — the game still under-accepts. **This is the highest-priority follow-up.**
   - Alternative to OpenAI: bind **Cloudflare Workers AI** (`env.AI`) and swap `askAi()` to call it — avoids an external key and egress. Keep the same `validateCategoryWord` interface.
2. **Decide the fallback policy** (`fallbackAccept` in `validateWord`). Today it's `false` (strict). Trade-off:
   - `false` → never lets nonsense through, but if AI is down a real unknown word is rejected (feels unfair).
   - `true` → never punishes a real word for infra failure, but lets nonsense through during an outage.
   - **Recommendation:** `false` in ranked/competitive rooms, `true` in casual/quick-play. Thread a `strict` flag from the room type.
3. **Warm the cache / expand seeds offline.** Add a script that pre-populates `word_cache` for the top few thousand words per category (from an open dataset) so launch traffic rarely hits the model. Keep it idempotent (`ON CONFLICT`).
4. **Build the challenge/dispute flow (#1c).** After a move, let an opponent tap "Challenge." Re-judge via AI; if overturned, refund/deduct correctly and **record the verdict in `word_cache`** so the dictionary self-improves. This turns validation into a feature, not a cost.
5. **Localization hook.** When you add Hindi/Hinglish categories (roadmap #18), the AI layer already generalizes — just add a `categoryPrompt` entry and a (possibly empty) seed list. Seed lists can't cover transliteration; AI can.

### Edge cases validation must handle (all covered or must be)
- Uppercase / whitespace / punctuation / digits → normalized then rejected if malformed.
- Word used in the wrong category (`samosa` as an animal) → rejected by seed + AI prompt is category-specific.
- Plurals / spelling variants (`tigers`, `rhinocerous`) → AI prompt says accept variants; seed won't. Consider a stemming pass before cache lookup to raise hit rate.
- Duplicate word already played in the room → handled in `route.ts` (`used` set), **before** validation, so you don't spend an AI call on a duplicate.
- Wrong starting letter → handled in `route.ts` before validation.
- Two-letter minimum → `isWellFormedWord` requires ≥2 letters.
- AI returns junk (not yes/no) → treated as `null` → fallback policy. Never throws.
- AI latency → `AbortController` timeout (3.5s default). A slow model must not stall the match; the server turn-timer (§below) still fires.

---

## 5. Scaling architecture

This is where "works for me and one friend" becomes "works for 5,000 concurrent players." Do these in order.

### 5.1 Move live rooms to Durable Objects + WebSockets  `(roadmap #5 — biggest win)`

**Problem today:** `components/game-client.tsx` polls `GET /api/game?code=...` every ~1.2s. Every poll is D1 reads. With N players in a room that's N×(1/1.2s) reads per room, forever, most returning nothing new. It's laggy *and* expensive, and there's no clean place for a precise turn timer.

**Target design:**
- **One Durable Object (DO) per room**, addressed by room code (`idFromName(code)`). The DO is the authority and holds live room state in its **transactional storage** (or in-memory + storage snapshot).
- Clients connect over **WebSocket** to the DO. Use the **Hibernatable WebSocket API** so idle rooms cost nothing.
- The DO uses **`alarm()`** for the turn deadline — fires exactly on time, no polling. This replaces the poll-driven `settleRoom` timeout logic.
- **D1 stays** for durable, cross-room data: `users`, `leaderboard_entries`, `word_cache`, and finished-match archives. The DO writes these on match end, not on every move.

**Migration path (don't big-bang it):**
1. Introduce a DO class `RoomDO` and route `POST/GET /api/game` room actions into it; keep the HTTP shape identical so the client keeps working.
2. Add a WebSocket endpoint; have the client open a socket and fall back to polling if it fails (progressive enhancement).
3. Once sockets are stable, delete the polling interval.

**Invariants to preserve:** server authority (§3), the exact turn-advance rules in `advance()`/`nextAlive()`, bot moves, and timeout = lose-a-life.

**Config:** DOs require a `wrangler` migration block (`new_sqlite_classes`/`new_classes`) and a binding. Document it in `wrangler`/hosting config in the same PR.

### 5.2 D1 usage & limits
- Batch related writes with `db.batch([...])` (already done in `route.ts`) — one round trip, atomic.
- **Index every hot query.** Present: `idx_players_room_code`, `idx_moves_room_created`. Add indexes for any new `WHERE`/`ORDER BY` you introduce (e.g. leaderboard by `wins`, `word_cache` PK already covers lookups).
- Keep `moves` from growing unbounded: archive or prune finished rooms (§5.5). Reads like `SELECT ... ORDER BY created_at DESC LIMIT 12` are fine; full-table scans are not.
- Avoid N+1: fetch players once per request and pass the array around (the code already does this).
- D1 has per-query and per-batch limits and is eventually-consistent across regions — do **not** use it as the real-time transport. That's what the DO is for.

### 5.3 Caching
- `word_cache` (done): each unknown word costs ≤1 model call ever.
- Cache the **leaderboard** response (it changes slowly) — Cloudflare Cache API or a short TTL in a DO/KV. Don't hit D1 for the leaderboard on every home-screen load.
- Static assets and the app shell → long cache + a service worker (§8).

### 5.4 Rate limiting & abuse protection  `(roadmap #24)`
- **Per-IP / per-user rate limits** on `POST /api/game` (room creation, joins, submits). Use Cloudflare Rate Limiting rules or a DO/KV token bucket. Without this, one script can create infinite rooms or spam moves.
- **Bot-signup / abuse:** add **Turnstile** on account creation and (optionally) room creation.
- **Input caps:** name ≤16 (done via `cleanName`), word ≤32 (done via `isWellFormedWord`), reject oversized JSON bodies.
- **Cost guard:** a per-IP cap on AI-triggering unknown-word submits (a stream of gibberish shouldn't run up model spend). Count misses; after K unknowns in a window, apply `fallbackAccept:false` without calling AI.

### 5.5 Room lifecycle & cleanup  `(roadmap #8)`
- Rooms are **never deleted today** → D1 fills with dead rooms/players/moves forever.
- Add a **Cron Trigger** (scheduled Worker) that runs every few minutes and deletes rooms `finished` or idle (`updated_at` older than TTL, e.g. 30–60 min), cascading to their `players` and `moves`.
- Handle **host leaves / player leaves:** on disconnect (DO knows via socket close), either substitute a bot, migrate host, or end the room if empty. A match must never be permanently frozen because one person closed a tab.
- **Reconnect:** allow rejoining with the existing `playerId`/`userId` within a grace window.

### 5.6 Schema drift — fix it
`db/schema.ts` (Drizzle) is **stale**; the live schema is the `CREATE TABLE IF NOT EXISTS` + `ALTER` block in `lib/game-db.ts` (it already has `turn_deadline`, `users`, `is_bot`, `leaderboard_entries`, `word_cache`). Pick one source of truth:
- **Recommended near-term:** keep `game-db.ts` auto-migrate (it's simple and works on Workers cold start), and update `db/schema.ts` to match so Drizzle types are correct.
- **Longer-term:** move to versioned Drizzle migrations run at deploy, and make `getGameDb()` just open the connection. Don't run heavy DDL on every cold start at scale.

---

## 6. Accounts & identity  `(roadmap #4, #6, #7)`

- Today identity = a name in `localStorage` + a client-generated `userId` (`stableUserId`). The **old** `leaderboard` table was keyed on display name (everyone named "Player" merged); the code has moved to `leaderboard_entries` keyed on `user_id` — **make sure the client always sends a stable `userId`** and the old name-keyed table is fully retired.
- Add **guest → Google/email** upgrade so progress survives reinstalls. Keep guest play one tap; never gate the first match.
- Store `users(id, display_name, ...)`; attach stats, MMR, currency, and entitlements to `user_id`.
- **Anti-spoof:** display name is cosmetic; identity is `user_id` (server-verified once real auth exists). Never trust a client-sent `userId` for anything sensitive until it's backed by a verified session/token.

---

## 7. Deployment & environments

- **Build:** `npm run build` (`vinext build`) → `dist/`. **Local run:** `npm run start` (`wrangler dev --config dist/server/wrangler.json`).
- **Bindings:** `DB` (D1) is injected by the hosting control plane (`.openai/hosting.json` → `"d1": "DB"`). New bindings (DO, KV, AI, Cron) must be declared in the wrangler/hosting config.
- **Secrets:** `OPENAI_API_KEY` (and any future keys) via `wrangler secret put NAME` or the hosting platform's secret UI. **Never** commit secrets or put them in client code.
- **Migrations:** currently auto-run in `getGameDb()`. When you adopt versioned migrations, run them as a deploy step, not per-request.
- **Environments:** create a **staging** deployment separate from production. Test schema changes and ad/billing wiring on staging first. Never point tests at the production D1.
- **Custom domain** (roadmap #14): move off `*.chatgpt.site` to a real domain before marketing and before a Play listing; update `metadataBase` in `app/layout.tsx` and OG URLs.
- **Rollback:** keep the previous deploy available; a bad word-validation or turn-engine change can break every live match at once.

---

## 8. PWA + Google Play (TWA)  `(roadmap #12, #13)`

**PWA first (prerequisite for Play):**
- Add `public/manifest.webmanifest` (name, short_name, icons 192/512, `theme_color:#d9ff64`, `background_color`, `display:standalone`, `start_url`).
- Add a **service worker**: precache the app shell + static assets; **let practice mode work offline**; network-first for `/api/game`. Handle SW updates cleanly (skipWaiting + clients.claim, with a "new version" refresh prompt).
- Add the icon set and an "Add to Home Screen" prompt.

**Then TWA for Play:**
- Wrap the PWA with **Bubblewrap** or **PWABuilder** into a Trusted Web Activity (loads your live site in a native shell — one codebase).
- Host **`/.well-known/assetlinks.json`** for Digital Asset Links domain verification (kills the browser URL bar).
- **New apps must target API level 36 (Android 16)** (requirement since Aug 2026). Set `targetSdk`/`compileSdk` accordingly.
- Play Console: content rating, **Data Safety** form (declare what you collect — see §13), privacy policy URL, store listing assets.
- **AdMob** (§9) integrates in the TWA layer; web uses AdSense/rewarded web.

---

## 9. Monetization plumbing  `(roadmap #15–#17 — do LAST)`

- **Server-authoritative economy:** coins, entitlements, and ad rewards live in D1 keyed on `user_id`. The client displays; the server grants.
- **Rewarded ads:** grant the reward only after a **verified server-side ad callback** (AdMob SSV). Never grant on a client "I watched it" claim.
- **Purchases:** validate receipts server-side — **Google Play Billing** (real-time developer notifications / verify purchase token) and **Stripe** webhooks on web. Unlock only after verification.
- **Placement policy (enforce in code, server-driven `ad_frequency` config):** rewarded = opt-in only; interstitial only after every 2–3 *completed* matches; **never during a live round.** Keep everything cosmetic — no pay-to-win, or ranked (#7) is meaningless.

---

## 10. Observability  `(roadmap #21 — wire before launch)`

- **Product analytics** (PostHog/Amplitude/Firebase): events for `match_start`, `match_end`, `move_submit` (with `source`: seed/cache/ai/fallback), `word_challenged`, funnel `home→first_match`, D1/D7 retention, ad + purchase events. Instrument **before** the first marketing push or the launch cohort is lost.
- **Error tracking** (Sentry): capture Worker exceptions (the big `try/catch` in `route.ts` currently swallows errors into a 500 — log them first) and client errors.
- **Structured logs + metrics:** log AI call rate, cache hit rate, average turn latency, timeout rate. These tell you if validation cost or lag is creeping.

---

## 11. Testing strategy

**Run:** `npm test` (unit), `npm run lint` (types+lint). Add the layers below.

### 11.1 Unit (node:test) — pure logic, no I/O
Already covered: `game-data` (category membership, blocklist) and `word-validation` (cascade). Extend to every pure function you add: MMR calc, turn-advance (`nextAlive`), scoring, currency math. **Rule: pure functions must be extractable and unit-tested without D1.** Remember explicit `.ts` import extensions.

### 11.2 Integration — the API against a real local D1
- Use `wrangler dev` (Miniflare) to run `route.ts` against a local D1, or `unstable_dev`/the Workers test pool (`@cloudflare/vitest-pool-workers`) so bindings (`DB`, DO, AI) exist in-test.
- Cover the full state machine: create → join → submit (valid/invalid) → timeout → win → leaderboard write. Assert DB rows, not just responses.
- Mock the AI `fetch` (as the unit tests do) so integration tests are deterministic and free.

### 11.3 End-to-end — real browser, two clients
- Playwright: open two browser contexts, create a room in one, join with the code in the other, play a full match, assert both UIs agree, someone wins, leaderboard updates.
- Test reconnect (close a tab, reopen), host-leaves, and the invite/share link deep-link.

### 11.4 Load / soak — before any paid campaign
- Script a few hundred concurrent rooms (k6/Artillery hitting the API, or a headless socket driver once DOs land). Watch: D1 read/write counts, Worker CPU/time, AI call rate, error rate, p95 turn latency.
- **Soak test:** run rooms for an hour; confirm the cleanup cron actually reclaims space and memory/DO storage doesn't grow unbounded.

### 11.5 Test data hygiene
- Never run tests against production D1. Use a disposable local/staging DB. Seed and tear down deterministically. No `Date.now()`-dependent assertions without injecting the clock (the validator already takes a `now()` for this reason).

---

## 12. Edge case catalog (make each one a test)

**Gameplay / turns**
- Player submits when it isn't their turn → 409, no state change.
- Two submits arrive nearly simultaneously (double-tap / two devices) → only one advances the turn; the second is rejected. (Needs the DO or a version/deadline guard.)
- Timer expires exactly as a submit lands → one outcome wins deterministically; player isn't charged twice.
- Last player standing / everyone but one is out → match ends, exactly one winner, leaderboard written once.
- All players run out of lives on the same tick → define the tie rule (last to lose a life, or highest score); don't leave `winner` null on a finished room.
- Bot has no valid word for the letter → bot loses a life (already handled in `settleRoom`); ensure it can't infinite-loop.
- Word with the correct last letter chains correctly; `q`→ words, `x`→ words: pick starter letters that always have options, or allow "no valid word → pass with penalty."

**Words / input**
- Empty, whitespace-only, emoji, non-ASCII, 1-letter, 33+ letters → rejected as malformed.
- Correct word, wrong starting letter → rejected before AI.
- Duplicate already-played word → rejected before AI (no wasted call).
- Slur or blocked word → rejected even if it's technically a valid category word.
- Valid word, category mismatch → rejected.
- AI down / slow / rate-limited / returns garbage → fallback policy, never a thrown 500, match continues.
- Unicode homoglyph / injection in the word or name (`'; DROP TABLE`) → parameterized queries only (the code uses `.bind()` — keep it that way; never string-concatenate SQL).

**Rooms / lifecycle**
- Join a full room (6) → 409.
- Join a finished room → 409.
- Join a non-existent code → 404.
- Room code collision on create → retried (already: 8 attempts).
- Host closes tab mid-match → bot substitution / host migration / graceful end.
- Everyone leaves → room cleaned up, not orphaned.
- Reconnect after a drop within grace window → same seat, same lives/score.
- Rejoin after grace window → treated as spectator or new joiner, not a duplicate live seat.

**Identity / leaderboard**
- Two users, same display name → separate `user_id` rows, separate stats.
- Missing/garbage `userId` from client → server generates a stable one; never crash.
- Spoofed `userId` (someone else's) → until real auth, don't let it mutate another user's sensitive data; sensitive writes require a verified session.

**Money (when added)**
- Client claims a reward/purchase without server verification → denied.
- Duplicate purchase/reward callback (retries) → idempotent; grant once.
- Refund/chargeback → revoke entitlement.

**Infra / limits**
- D1 unavailable → clear 5xx, logged, client shows a friendly retry — not a white screen.
- Cold start runs DDL → still fast enough; at scale, move DDL out of the request path (§5.6).
- Oversized/malformed JSON body → 400, not a 500.

---

## 13. Security, privacy & legal  `(roadmap #22, #23 — gates for launch)`

- **SQL:** parameterized queries only (`.bind()`), everywhere. No string interpolation into SQL.
- **XSS:** never `dangerouslySetInnerHTML` with user content; React escaping is your friend. Names/words render as text.
- **Secrets:** server-only, never in the bundle. Rotate if leaked.
- **CORS/CSRF:** the API is same-origin; if you add cross-origin clients, lock down origins and use tokens.
- **Legal (required for Play + ads):** privacy policy + terms pages, a **Data Safety** declaration matching what you actually collect (device id, gameplay, ad id), a cookie/ads **consent** flow (EU + India DPDP), and an in-app **"Delete my account & data"** flow. Age-gate if you target under-13s (COPPA / Play Families).
- **Moderation:** blocklist on words *and* names (names aren't filtered yet — add it), plus **report & block**, and a lightweight **admin panel** to manage categories, banned words, and players.

---

## 14. Definition of Done (every PR)

- [ ] `npm test` passes; new pure logic has unit tests.
- [ ] `npm run lint` passes (fix new errors; don't add to the pre-existing debt in `game-client.tsx`/`chart.tsx` — and ideally chip at it).
- [ ] Server remains the authority; no client-trusted score/lives/valid/currency.
- [ ] All new inputs validated + bounded; new SQL is parameterized and indexed.
- [ ] New user-generated surfaces are filtered, rate-limited, and reportable.
- [ ] Edge cases from §12 relevant to the change are covered by tests.
- [ ] No secrets in client code; new bindings/secrets documented in the deploy config.
- [ ] Cost impact considered (D1 reads/writes, AI calls); caching added where hot.
- [ ] Analytics/error events added for new flows.
- [ ] This brief updated if an invariant (§3) or the schema (§5.6) changed.

---

## 15. Suggested build order (milestones)

**M1 — Credibility (make it fair).** Turn on `OPENAI_API_KEY`; ship the challenge flow; confirm no valid word ever loses a life. Retire the old name-keyed leaderboard fully. *(roadmap #1, #4)*

**M2 — Alive & instant.** Durable Objects + WebSockets; precise server turn-timer via `alarm()`; reconnect/leave/cleanup; quick-play bots that start a match instantly. *(#2, #3, #5, #8, #9)*

**M3 — Retention.** Accounts (guest→Google), profiles + MMR + ranked ladder, daily challenge + streaks, sound/juice/haptics. *(#6, #7, #10, #11)*

**M4 — Distribution.** PWA (offline practice) → TWA on Google Play (target API 36); custom domain + share/SEO; analytics + error tracking live; legal pages + account deletion. *(#12–#14, #21, #22)*

**M5 — Money.** Rewarded ads (server-verified) + remove-ads IAP + cosmetics; server-side economy + receipt validation; moderation + admin panel. *(#15–#17, #23)*

**M6 — Growth.** More categories + Hindi/Hinglish; tournaments/leagues/clans; reactions + shareable replays; load/soak hardening. *(#18–#20, #24)*

---

**North star:** the core loop is already fun. Everything here exists to make it **fair (M1), alive (M2), sticky (M3), reachable (M4), and monetizable (M5)** — in that order — on a foundation that doesn't fall over when real players arrive. Build one milestone at a time, test every edge case, and never trust the client.
