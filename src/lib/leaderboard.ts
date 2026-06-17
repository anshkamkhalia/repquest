export type LeaderUser = {
  id: string;
  username: string;
  points: number;
  streak: number;
  quests: number;
};

const DEMO_USERS: LeaderUser[] = [
  { id: '1', username: 'IronWill', points: 4820, streak: 21, quests: 156 },
  { id: '2', username: 'RepQueen', points: 4510, streak: 18, quests: 142 },
  { id: '3', username: 'QuestKing', points: 4190, streak: 14, quests: 128 },
  { id: '4', username: 'FlexNova', points: 3875, streak: 12, quests: 119 },
  { id: '5', username: 'StreakSavage', points: 3620, streak: 9, quests: 104 },
  { id: '6', username: 'CoreCrusher', points: 3310, streak: 11, quests: 97 },
  { id: '7', username: 'PushUpPro', points: 2980, streak: 7, quests: 88 },
  { id: '8', username: 'MidnightRep', points: 2745, streak: 6, quests: 81 },
  { id: '9', username: 'FormFirst', points: 2510, streak: 8, quests: 74 },
  { id: '10', username: 'DailyGrind', points: 2280, streak: 5, quests: 69 },
  { id: '11', username: 'RepRookie', points: 1940, streak: 4, quests: 58 },
];

export type RankTier = { label: string; tone: 'gold' | 'silver' | 'bronze' | 'neutral' };

export function getRankTier(rank: number, total: number): RankTier {
  if (rank === 1) return { label: 'Legend', tone: 'gold' };
  if (rank <= Math.max(1, Math.ceil(total * 0.1))) return { label: 'Elite', tone: 'silver' };
  if (rank <= Math.max(1, Math.ceil(total * 0.5))) return { label: 'Contender', tone: 'bronze' };
  return { label: 'Rising', tone: 'neutral' };
}

export function getInitials(username: string): string {
  return username.slice(0, 2).toUpperCase();
}

/** Merge the live user into the demo board and return it sorted by points. */
export function buildLeaderboard(current: {
  username: string;
  points: number;
  streak: number;
  quests: number;
}): LeaderUser[] {
  const merged: LeaderUser[] = [
    ...DEMO_USERS,
    { id: 'me', username: current.username, points: current.points, streak: current.streak, quests: current.quests },
  ];
  return merged.sort((a, b) => b.points - a.points);
}
