import { useLocalSearchParams } from 'expo-router';

import { WorkoutPreview } from '@/components/workout-preview';

export default function WorkoutScreen() {
  // `workout` is also a tab route (see app-tabs.tsx), so starting a new quest
  // can land on this same already-mounted screen instead of a fresh one.
  // Keying on the quest params forces a real remount — fresh state — instead
  // of leaving a finished quest's "Quest complete" card stuck on screen.
  const { exercise, difficulty } = useLocalSearchParams<{
    exercise?: string;
    difficulty?: string;
  }>();
  return <WorkoutPreview key={`${exercise}-${difficulty}`} />;
}
