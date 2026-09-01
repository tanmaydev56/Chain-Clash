import { DurableObject } from 'cloudflare:workers';
import { categories, normalizeWord, type Category } from '../../lib/game-data';
import { verifyRealtimeTicket } from '../../lib/realtime-ticket';
import { categoryValidationDefinition, d1WordCache, validateCategoryWord } from '../../lib/word-validation';
import { ROOM_POLICY, RoomCommandQueue, addBot, publicRoomState, resolveAlarm, resolveDisconnectGrace, setConnected, shouldExpireRoom, submitWord, type RealtimeRoomState } from './room-engine';

export interface RealtimeEnv { DB: D1Database; ROOMS: DurableObjectNamespace<ChainClashRoom>; AI: Ai; REALTIME_TICKET_SECRET: string; APP_ORIGIN?: string }
type Connection = { userId: string; playerId: string; sessionId: string };
type Command = { type?: 'refresh' | 'submit_word' | 'add_bot'; commandId?: string; word?: string };

function weekKey(now: number) { const date = new Date(now); const day = date.getUTCDay() || 7; date.setUTCDate(date.getUTCDate() - day + 1); return date.toISOString().slice(0, 10); }
function previousUtcDay(day: string) { return new Date(new Date(`${day}T00:00:00.000Z`).getTime() - 86_400_000).toISOString().slice(0, 10); }

export class ChainClashRoom extends DurableObject<RealtimeEnv> {
  private snapshot: RealtimeRoomState | null = null;
  private commandQueue = new RoomCommandQueue();

  async fetch(request: Request) {
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return new Response('Expected WebSocket upgrade.', { status: 426 });
    if (!this.env.APP_ORIGIN || request.headers.get('Origin') !== this.env.APP_ORIGIN) return new Response('Origin not allowed.', { status: 403 });
    if (!this.env.REALTIME_TICKET_SECRET || this.env.REALTIME_TICKET_SECRET.length < 32) return new Response('Realtime ticket verification is unavailable.', { status: 503 });
    const url = new URL(request.url); const route = url.pathname.match(/^\/rooms\/([A-Z0-9]{6})$/i); const code = route?.[1]?.toUpperCase() ?? '';
    if (!code) return new Response('Room not found.', { status: 404 });
    const ticket = await verifyRealtimeTicket(url.searchParams.get('ticket') ?? '', this.env.REALTIME_TICKET_SECRET);
    if (!ticket || ticket.roomCode !== code) return new Response('Invalid realtime ticket.', { status: 401 });
    const session = await this.env.DB.prepare('SELECT 1 AS valid FROM guest_sessions WHERE id=? AND user_id=? AND revoked_at IS NULL AND expires_at>?').bind(ticket.sessionId,ticket.userId,Date.now()).first<{ valid: number }>();
    if (!session) return new Response('Guest session is no longer valid.', { status: 401 });
    const seat = await this.env.DB.prepare('SELECT id,name,is_bot,score,lives,joined_at FROM players WHERE room_code=? AND user_id=?').bind(code, ticket.userId).first<{ id: string; name: string; is_bot: number; score: number; lives: number; joined_at: number }>();
    if (!seat || seat.id !== ticket.playerId) return new Response('Room membership required.', { status: 403 });
    return this.commandQueue.run(async () => {
      if (await this.ctx.storage.get<number>(`ticket:${ticket.nonce}`)) return new Response('Realtime ticket was already used.', { status: 401 });
      await this.ensureSnapshot(code);
      const snapshot = this.requireSnapshot();
      let addedSeat = false;
      if (!snapshot.players.some((player) => player.id === seat.id)) {
        if (snapshot.status === 'finished') return new Response('This match has finished.', { status: 409 });
        snapshot.players.push({ id: seat.id, userId: ticket.userId, name: seat.name, bot: Boolean(seat.is_bot), score: seat.score, lives: seat.lives, joinedAt: seat.joined_at, disconnectedAt: null });
        addedSeat = true; snapshot.version += 1; snapshot.updatedAt = Date.now();
        if (snapshot.status === 'waiting') {
          const room = await this.env.DB.prepare('SELECT host_player_id,status,current_letter,turn_player_id,turn_deadline,state_version,updated_at FROM rooms WHERE code=?').bind(code).first<{ host_player_id: string; status: 'waiting' | 'active' | 'finished'; current_letter: string; turn_player_id: string | null; turn_deadline: number | null; state_version: number; updated_at: number }>();
          if (!room) return new Response('Room not found.', { status: 404 });
          snapshot.hostPlayerId = room.host_player_id; snapshot.status = room.status; snapshot.currentLetter = room.current_letter; snapshot.turnPlayerId = room.turn_player_id; snapshot.deadline = room.turn_deadline; snapshot.version = Math.max(snapshot.version, room.state_version); snapshot.updatedAt = room.updated_at;
        }
      }
      await this.ctx.storage.put(`ticket:${ticket.nonce}`, ticket.expiresAt);
      this.snapshot = setConnected(this.requireSnapshot(), ticket.userId, true, Date.now()); await this.save(addedSeat);
      const pair = new WebSocketPair(); const [client, server] = Object.values(pair);
      this.ctx.acceptWebSocket(server, [`user:${ticket.userId}`]); server.serializeAttachment({ userId: ticket.userId, playerId: ticket.playerId, sessionId: ticket.sessionId } satisfies Connection);
      this.broadcastState(); await this.schedule();
      return new Response(null, { status: 101, webSocket: client });
    });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    await this.enqueue(() => this.handleWebSocketMessage(ws, message));
  }

  private async handleWebSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    await this.restoreSnapshot();
    const connection = ws.deserializeAttachment() as Connection | null;
    if (!connection || typeof message !== 'string') return this.reject(ws, 'Invalid realtime command.');
    let command: Command; try { command = JSON.parse(message) as Command; } catch { return this.reject(ws, 'Invalid realtime command.'); }
    if (command.type === 'refresh') return ws.send(JSON.stringify({ type: 'room_state', state: publicRoomState(this.requireSnapshot()) }));
    if (!command.commandId) return this.reject(ws, 'Command ID is required.');
    const before = this.requireSnapshot(); let result;
    if (command.type === 'add_bot') result = addBot(before, connection.userId, command.commandId, Date.now());
    else if (command.type === 'submit_word') {
      const word = normalizeWord(command.word ?? '');
      const canJudge = before.status === 'active' && before.turnPlayerId === connection.playerId && word.startsWith(before.currentLetter) && !before.usedWords.includes(word);
      const verdict = canJudge ? await validateCategoryWord(before.category, command.word ?? '', { cache: d1WordCache(this.env.DB), judge: (category, candidate, timeout) => this.workersAiJudge(category, candidate, timeout), fallbackAccept: false, timeoutMs: 2500 }) : { valid: false as const, source: 'malformed' as const, word };
      result = submitWord(before, connection.userId, command.commandId, command.word ?? '', verdict.valid, Date.now());
      if (result.accepted) ws.send(JSON.stringify({ type: 'move_result', commandId: command.commandId, valid: result.move?.valid ?? false, source: verdict.source }));
    } else return this.reject(ws, 'Unknown realtime command.');
    if (!result.accepted) return this.reject(ws, result.error ?? 'Command rejected.', command.commandId);
    this.snapshot = result.state; await this.save(true); this.broadcastState(); await this.schedule();
  }

  async webSocketClose(ws: WebSocket) {
    await this.enqueue(() => this.handleWebSocketClose(ws));
  }

  private async handleWebSocketClose(ws: WebSocket) {
    await this.restoreSnapshot();
    const connection = ws.deserializeAttachment() as Connection | null; if (!connection) return;
    if (this.ctx.getWebSockets(`user:${connection.userId}`).filter((socket) => socket.readyState === WebSocket.OPEN).length === 0) {
      this.snapshot = setConnected(this.requireSnapshot(), connection.userId, false, Date.now()); await this.save(true); this.broadcastState(); await this.schedule();
    }
  }
  async webSocketError(ws: WebSocket) { await this.webSocketClose(ws); }

  async alarm() {
    await this.enqueue(() => this.handleAlarm());
  }

  private async handleAlarm() {
    const stored = await this.ctx.storage.get<RealtimeRoomState>('snapshot'); if (!stored) return; this.snapshot = stored; const now = Date.now();
    const ticketEntries = await this.ctx.storage.list<number>({ prefix: 'ticket:' });
    const expiredTickets = [...ticketEntries].filter(([, expiresAt]) => expiresAt <= now).map(([key]) => key);
    if (expiredTickets.length) await this.ctx.storage.delete(expiredTickets);
    if (shouldExpireRoom(stored, now)) { for (const socket of this.ctx.getWebSockets()) socket.close(1001, 'Room expired'); await this.ctx.storage.deleteAll(); return; }
    const afterDisconnects = resolveDisconnectGrace(stored, now); const next = resolveAlarm(afterDisconnects, now); if (next !== stored) { this.snapshot = next; await this.save(true); this.broadcastState(); }
    await this.schedule();
  }

  private async ensureSnapshot(code: string) {
    if (this.snapshot?.code === code) return; const stored = await this.ctx.storage.get<RealtimeRoomState>('snapshot'); if (stored?.code === code) { this.snapshot = stored; return; }
    const room = await this.env.DB.prepare('SELECT code,host_player_id,category,status,current_letter,turn_player_id,winner_player_id,turn_deadline,challenge_key,state_version,updated_at FROM rooms WHERE code=?').bind(code).first<{ code: string; host_player_id: string; category: Category; status: 'waiting' | 'active' | 'finished'; current_letter: string; turn_player_id: string | null; winner_player_id: string | null; turn_deadline: number | null; challenge_key: string | null; state_version: number; updated_at: number }>();
    if (!room || !(room.category in categories)) throw new Error('Room not found.');
    const players = await this.env.DB.prepare('SELECT id,user_id,name,is_bot,score,lives,joined_at FROM players WHERE room_code=? ORDER BY joined_at').bind(code).all<{ id: string; user_id: string | null; name: string; is_bot: number; score: number; lives: number; joined_at: number }>();
    const moves = await this.env.DB.prepare('SELECT id,player_id,word,valid,created_at FROM moves WHERE room_code=? ORDER BY created_at').bind(code).all<{ id: string; player_id: string; word: string; valid: number; created_at: number }>();
    const finalization = await this.env.DB.prepare('SELECT stats_recorded FROM rooms WHERE code=?').bind(code).first<{ stats_recorded: number }>();
    this.snapshot = { code, hostPlayerId: room.host_player_id, category: room.category, status: room.status, currentLetter: room.current_letter, turnPlayerId: room.turn_player_id, winnerPlayerId: room.winner_player_id, deadline: room.turn_deadline, challengeKey: room.challenge_key, version: room.state_version, players: players.results.map((p) => ({ id: p.id, userId: p.user_id, name: p.name, bot: Boolean(p.is_bot), score: p.score, lives: p.lives, joinedAt: p.joined_at, disconnectedAt: null })), moves: moves.results.map((m) => ({ id: m.id, playerId: m.player_id, word: m.word, valid: Boolean(m.valid), createdAt: m.created_at })), usedWords: moves.results.filter((m) => m.valid).map((m) => m.word), processedCommands: [], updatedAt: room.updated_at, finalized: Boolean(finalization?.stats_recorded) };
    await this.ctx.storage.put('snapshot', this.snapshot);
  }

  private async save(persistD1: boolean) {
    const state = this.requireSnapshot(); await this.ctx.storage.put('snapshot', state); if (!persistD1) return;
    const lastMove = state.moves.at(-1); const statements: D1PreparedStatement[] = [];
    if (lastMove) statements.push(this.env.DB.prepare('INSERT OR IGNORE INTO moves (id,room_code,player_id,word,valid,created_at) VALUES (?,?,?,?,?,?)').bind(lastMove.id,state.code,lastMove.playerId,lastMove.word,lastMove.valid?1:0,lastMove.createdAt));
    for (const p of state.players) statements.push(this.env.DB.prepare(`INSERT INTO players (id,user_id,room_code,name,is_bot,score,lives,joined_at,last_seen_at) VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,score=excluded.score,lives=excluded.lives,last_seen_at=excluded.last_seen_at`).bind(p.id,p.userId,state.code,p.name,p.bot?1:0,p.score,p.lives,p.joinedAt,state.updatedAt));
    statements.push(this.env.DB.prepare('UPDATE rooms SET host_player_id=?,status=?,current_letter=?,turn_player_id=?,winner_player_id=?,turn_deadline=?,state_version=?,updated_at=? WHERE code=?').bind(state.hostPlayerId,state.status,state.currentLetter,state.turnPlayerId,state.winnerPlayerId,state.deadline,state.version,state.updatedAt,state.code));
    await this.env.DB.batch(statements); if (state.status === 'finished' && !state.finalized) await this.finalize();
  }

  private async finalize() {
    const state = this.requireSnapshot();
    const winner = state.players.find((player) => player.id === state.winnerPlayerId);
    const now = Date.now();
    const statements: D1PreparedStatement[] = [];
    if (winner?.userId) {
      statements.push(
        this.env.DB.prepare(`INSERT INTO leaderboard_entries (user_id,player_name,wins,best_score,updated_at)
          SELECT ?,?,1,?,? WHERE EXISTS (SELECT 1 FROM rooms WHERE code=? AND stats_recorded=0)
          ON CONFLICT(user_id) DO UPDATE SET player_name=excluded.player_name,wins=wins+1,best_score=MAX(best_score,excluded.best_score),updated_at=excluded.updated_at`).bind(winner.userId,winner.name,winner.score,now,state.code),
        this.env.DB.prepare(`INSERT INTO weekly_leaderboard (user_id,week_key,player_name,wins,best_score,updated_at)
          SELECT ?,?,?,1,?,? WHERE EXISTS (SELECT 1 FROM rooms WHERE code=? AND stats_recorded=0)
          ON CONFLICT(user_id,week_key) DO UPDATE SET player_name=excluded.player_name,wins=wins+1,best_score=MAX(best_score,excluded.best_score),updated_at=excluded.updated_at`).bind(winner.userId,weekKey(now),winner.name,winner.score,now,state.code),
      );
    }
    for (const player of state.players.filter((candidate) => candidate.userId && !candidate.bot)) {
      const won = player.id === winner?.id ? 1 : 0;
      const xp = player.score + (won ? 100 : 25);
      statements.push(this.env.DB.prepare(`INSERT INTO player_stats (user_id,games_played,wins,losses,best_score,total_score,xp,updated_at)
        SELECT ?,1,?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM rooms WHERE code=? AND stats_recorded=0)
        ON CONFLICT(user_id) DO UPDATE SET games_played=games_played+1,wins=wins+excluded.wins,losses=losses+excluded.losses,best_score=MAX(best_score,excluded.best_score),total_score=total_score+excluded.total_score,xp=xp+excluded.xp,mmr=MAX(100,mmr+?),updated_at=excluded.updated_at`).bind(player.userId,won,won?0:1,player.score,player.score,xp,now,state.code,won?25:-20));
      if (state.challengeKey) {
        statements.push(this.env.DB.prepare(`INSERT OR IGNORE INTO daily_attempts (user_id,challenge_key,score,won,completed_at)
          SELECT ?,?,?,?,? WHERE EXISTS (SELECT 1 FROM rooms WHERE code=? AND stats_recorded=0)`).bind(player.userId,state.challengeKey,player.score,won,now,state.code));
        statements.push(this.env.DB.prepare(`UPDATE player_stats SET daily_streak=CASE WHEN last_daily_key=? THEN daily_streak WHEN last_daily_key=? THEN daily_streak+1 ELSE 1 END,last_daily_key=?,updated_at=? WHERE user_id=? AND EXISTS (SELECT 1 FROM rooms WHERE code=? AND stats_recorded=0)`).bind(state.challengeKey,previousUtcDay(state.challengeKey),state.challengeKey,now,player.userId,state.code));
      }
    }
    statements.push(this.env.DB.prepare('UPDATE rooms SET stats_recorded=1 WHERE code=? AND stats_recorded=0').bind(state.code));
    await this.env.DB.batch(statements);
    state.finalized = true;
    await this.ctx.storage.put('snapshot', state);
  }

  private async workersAiJudge(category:Category,word:string,timeoutMs:number){const inference=this.env.AI.run('@cf/meta/llama-3.1-8b-instruct-fast',{messages:[{role:'system',content:'Strict word-game classifier. Return exactly {"valid":true} or {"valid":false}. Reject uncertainty.'},{role:'user',content:`Is "${word}" ${categoryValidationDefinition(category)}?`} ]});const response=await Promise.race([inference,new Promise<null>((resolve)=>setTimeout(()=>resolve(null),timeoutMs))]);if(!response||typeof response!=='object')return null;const text='response' in response&&typeof response.response==='string'?response.response.trim():'';if(text==='{"valid":true}')return true;if(text==='{"valid":false}')return false;return null;}
  private async enqueue(operation:()=>Promise<void>){await this.commandQueue.run(operation);}
  private async schedule(){const s=this.requireSnapshot();const now=Date.now();const humans=s.players.filter((p)=>!p.bot);const noHumansConnected=humans.every((p)=>p.disconnectedAt!==null);const host=s.players.find((p)=>p.id===s.hostPlayerId);const hostGrace=s.status==='waiting'&&host?.disconnectedAt&&humans.some((p)=>p.id!==host.id&&p.disconnectedAt===null)?host.disconnectedAt+ROOM_POLICY.reconnectGraceMs:null;const lifecycle=s.status==='finished'?s.updatedAt+ROOM_POLICY.finishedRetentionMs:noHumansConnected?s.updatedAt+(s.status==='waiting'?ROOM_POLICY.emptyWaitingMs:ROOM_POLICY.abandonedActiveMs):now+ROOM_POLICY.emptyWaitingMs;const alarm=Math.min(...[s.deadline,hostGrace,lifecycle].filter((value):value is number=>typeof value==='number'));await this.ctx.storage.setAlarm(Math.max(now+100,alarm));}
  private async restoreSnapshot(){if(this.snapshot)return;this.snapshot=await this.ctx.storage.get<RealtimeRoomState>('snapshot')??null;}
  private requireSnapshot(){if(!this.snapshot)throw new Error('Room state is unavailable.');return this.snapshot;}
  private reject(ws:WebSocket,error:string,commandId?:string){ws.send(JSON.stringify({type:'error',commandId,error}));}
  private broadcastState(){const payload=JSON.stringify({type:'room_state',state:publicRoomState(this.requireSnapshot())});for(const ws of this.ctx.getWebSockets())if(ws.readyState===WebSocket.OPEN)ws.send(payload);}
}

export default {fetch(request:Request,env:RealtimeEnv){const match=new URL(request.url).pathname.match(/^\/rooms\/([A-Z0-9]{6})$/i);const code=match?.[1]?.toUpperCase()??'';if(!code)return new Response('Room not found.',{status:404});return env.ROOMS.getByName(code).fetch(request);}} satisfies ExportedHandler<RealtimeEnv>;
