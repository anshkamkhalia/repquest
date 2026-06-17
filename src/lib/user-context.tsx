import { createContext, useCallback, useContext, useMemo, useState } from 'react';

import { STREAK_THRESHOLD, type DifficultyPref } from '@/constants/workout-rules';

export type UserSettings = {
  notificationsEnabled: boolean;
  difficulty: DifficultyPref;
  frequency: number;
  downtimeStart: number;
  downtimeEnd: number;
};

type UserStats = {
  username: string;
  points: number;
  streak: number;
  quests: number;
  pointsToday: number;
  streakCreditedToday: boolean;
};

export type QuestResult = {
  pointsAdded: number;
  pointsToday: number;
  streakExtended: boolean;
  streakReady: boolean;
};

type UserContextValue = UserStats & {
  settings: UserSettings;
  completeQuest: (points: number) => QuestResult;
  updateSettings: (patch: Partial<UserSettings>) => void;
};

const INITIAL_STATS: UserStats = {
  username: 'You',
  points: 340,
  streak: 7,
  quests: 22,
  pointsToday: 0,
  streakCreditedToday: false,
};

const INITIAL_SETTINGS: UserSettings = {
  notificationsEnabled: true,
  difficulty: 'auto',
  frequency: 3,
  downtimeStart: 22,
  downtimeEnd: 7,
};

const UserContext = createContext<UserContextValue | null>(null);

export function UserProvider({ children }: { children: React.ReactNode }) {
  const [stats, setStats] = useState<UserStats>(INITIAL_STATS);
  const [settings, setSettings] = useState<UserSettings>(INITIAL_SETTINGS);

  const completeQuest = useCallback((points: number): QuestResult => {
    let result: QuestResult = {
      pointsAdded: points,
      pointsToday: 0,
      streakExtended: false,
      streakReady: false,
    };

    setStats((prev) => {
      const pointsToday = prev.pointsToday + points;
      const reachedThreshold = pointsToday >= STREAK_THRESHOLD;
      const streakExtended = reachedThreshold && !prev.streakCreditedToday;

      result = {
        pointsAdded: points,
        pointsToday,
        streakExtended,
        streakReady: reachedThreshold,
      };

      return {
        ...prev,
        points: prev.points + points,
        quests: prev.quests + 1,
        pointsToday,
        streak: streakExtended ? prev.streak + 1 : prev.streak,
        streakCreditedToday: prev.streakCreditedToday || reachedThreshold,
      };
    });

    return result;
  }, []);

  const updateSettings = useCallback((patch: Partial<UserSettings>) => {
    setSettings((prev) => ({ ...prev, ...patch }));
  }, []);

  const value = useMemo<UserContextValue>(
    () => ({ ...stats, settings, completeQuest, updateSettings }),
    [stats, settings, completeQuest, updateSettings],
  );

  return <UserContext.Provider value={value}>{children}</UserContext.Provider>;
}

export function useUser() {
  const ctx = useContext(UserContext);
  if (!ctx) throw new Error('useUser must be used within UserProvider');
  return ctx;
}
