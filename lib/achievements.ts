export type AchievementContext = { gamesPlayed: number; wins: number; dailyStreak: number; chainLength: number; flawless: boolean; mode: string; categoryWins: number; powerUpsUsed: number };
export const achievements = [
  { id: 'first_win', name: 'First Crown', description: 'Win your first match.', check: (c: AchievementContext) => c.wins >= 1 },
  { id: 'daily_7', name: 'Daily Devotion', description: 'Reach a 7-day Daily streak.', check: (c: AchievementContext) => c.dailyStreak >= 7 },
  { id: 'chain_10', name: 'Chain Reaction', description: 'Make a 10-word chain.', check: (c: AchievementContext) => c.chainLength >= 10 },
  { id: 'flawless', name: 'Flawless', description: 'Win without losing a life.', check: (c: AchievementContext) => c.flawless },
  { id: 'blitz_win', name: 'Lightning Crown', description: 'Win a Blitz match.', check: (c: AchievementContext) => c.mode === 'blitz' && c.wins >= 1 },
  { id: 'survivor', name: 'Survivor', description: 'Win Survival.', check: (c: AchievementContext) => c.mode === 'survival' && c.wins >= 1 },
  { id: 'polyglot', name: 'Polyglot', description: 'Win in all four categories.', check: (c: AchievementContext) => c.categoryWins >= 4 },
  { id: 'big_spender', name: 'Big Spender', description: 'Use 10 power-ups.', check: (c: AchievementContext) => c.powerUpsUsed >= 10 },
  { id: 'centurion', name: 'Centurion', description: 'Play 100 matches.', check: (c: AchievementContext) => c.gamesPlayed >= 100 },
] as const;
