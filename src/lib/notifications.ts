import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import {
  EXERCISE_CONFIG,
  randomQuest,
  resolveDifficulty,
  type Difficulty,
  type Quest,
} from '@/constants/workout-rules';
import type { UserSettings } from '@/lib/user-context';

let handlerConfigured = false;

export function configureNotificationHandler() {
  if (Platform.OS === 'web' || handlerConfigured) return;
  handlerConfigured = true;
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldPlaySound: true,
      shouldSetBadge: false,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  });
}

export function questUrl(quest: Quest): string {
  return `/workout?exercise=${quest.exercise}&difficulty=${quest.difficulty}&quest=1`;
}

export function questNotificationBody(quest: Quest): string {
  const config = EXERCISE_CONFIG[quest.exercise];
  const unit = config.unit === 'sec' ? `${quest.target} sec` : `${quest.target} reps`;
  return `${unit} · ${config.title}. Tap to start your quest.`;
}

export async function requestNotificationsPermission(): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return true;
  const next = await Notifications.requestPermissionsAsync();
  return next.granted;
}

/** Hours (0-23) when notifications are allowed (outside the downtime window). */
function allowedHours(start: number, end: number): number[] {
  const hours: number[] = [];
  for (let h = 0; h < 24; h += 1) {
    const inDowntime = start === end ? false : start < end ? h >= start && h < end : h >= start || h < end;
    if (!inDowntime) hours.push(h);
  }
  return hours.length ? hours : Array.from({ length: 24 }, (_, h) => h);
}

function randomFutureTime(hours: number[]): Date {
  const now = new Date();
  const hour = hours[Math.floor(Math.random() * hours.length)];
  const minute = Math.floor(Math.random() * 60);
  const date = new Date();
  date.setHours(hour, minute, 0, 0);
  if (date.getTime() <= now.getTime() + 60_000) {
    date.setDate(date.getDate() + 1);
  }
  return date;
}

export async function cancelAllChallenges() {
  if (Platform.OS === 'web') return;
  await Notifications.cancelAllScheduledNotificationsAsync();
}

/** Schedule `frequency` random challenges across the allowed hours. */
export async function scheduleChallenges(settings: UserSettings, points: number) {
  if (Platform.OS === 'web') return;
  await Notifications.cancelAllScheduledNotificationsAsync();
  if (!settings.notificationsEnabled) return;

  const hours = allowedHours(settings.downtimeStart, settings.downtimeEnd);
  const difficulty: Difficulty = resolveDifficulty(settings.difficulty, points);

  for (let i = 0; i < settings.frequency; i += 1) {
    const quest = randomQuest(difficulty);
    await Notifications.scheduleNotificationAsync({
      content: {
        title: 'A quest dropped',
        body: questNotificationBody(quest),
        data: { url: questUrl(quest) },
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: randomFutureTime(hours),
      },
    });
  }
}

/** Fire a challenge a few seconds from now so the flow can be tested on a device. */
export async function sendTestChallenge(settings: UserSettings, points: number): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  const difficulty = resolveDifficulty(settings.difficulty, points);
  const quest = randomQuest(difficulty);
  await Notifications.scheduleNotificationAsync({
    content: {
      title: 'A quest dropped',
      body: questNotificationBody(quest),
      data: { url: questUrl(quest) },
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
      seconds: 3,
    },
  });
  return true;
}
