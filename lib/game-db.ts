import { env } from 'cloudflare:workers';

/** Production schema is owned by checked-in Drizzle migrations. */
export async function getGameDb() {
  const db = env.DB;
  if (!db) throw new Error('Game database is unavailable.');
  return db;
}
