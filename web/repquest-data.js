/**
 * RepQuest shared user data.
 * Signup/login pages should read/write `REPQUEST_STORAGE_KEY` in localStorage.
 *
 * Example after signup:
 *   const users = JSON.parse(localStorage.getItem('repquest_users') || '[]');
 *   users.push({ id, username, points: 0, streak: 0, quests: 0 });
 *   localStorage.setItem('repquest_users', JSON.stringify(users));
 */
const REPQUEST_STORAGE_KEY = 'repquest_users';

const DEFAULT_USERS = [
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
  { id: '12', username: 'You', points: 340, streak: 7, quests: 22 },
];

function getLeaderboardUsers() {
  try {
    const raw = localStorage.getItem(REPQUEST_STORAGE_KEY);
    const stored = raw ? JSON.parse(raw) : [];
    const users = Array.isArray(stored) && stored.length ? stored : DEFAULT_USERS;
    return [...users].sort((a, b) => b.points - a.points);
  } catch {
    return [...DEFAULT_USERS].sort((a, b) => b.points - a.points);
  }
}

function getRankTier(rank, total) {
  if (rank === 1) return { label: 'Legend', className: 'hard' };
  if (rank <= Math.max(1, Math.ceil(total * 0.1))) return { label: 'Elite', className: 'medium' };
  if (rank <= Math.max(1, Math.ceil(total * 0.5))) return { label: 'Contender', className: 'easy' };
  return { label: 'Rising', className: 'easy' };
}

function getInitials(username) {
  return username.slice(0, 2).toUpperCase();
}

function formatPoints(points) {
  return points.toLocaleString();
}
