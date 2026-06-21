import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Card, Kicker, Screen, StatCard, Title } from '@/components/ui/brand-ui';
import { Brand } from '@/constants/brand';
import { Fonts } from '@/constants/theme';
import {
  DIFFICULTIES,
  DIFFICULTY_LABEL,
  EXERCISE_CONFIG,
  EXERCISE_IDS,
  STREAK_THRESHOLD,
  buildQuest,
  resolveDifficulty,
  type Difficulty,
  type ExerciseId,
  type Quest,
} from '@/constants/workout-rules';
import { buildLeaderboard } from '@/lib/leaderboard';
import { useUser } from '@/lib/user-context';

function questLabel(quest: Quest): string {
  const config = EXERCISE_CONFIG[quest.exercise];
  return `${quest.target} ${config.title}`;
}

function startQuest(quest: Quest) {
  router.push({
    pathname: '/workout',
    params: { exercise: quest.exercise, difficulty: quest.difficulty },
  });
}

export default function HomeScreen() {
  const user = useUser();
  const autoDifficulty = resolveDifficulty(user.settings.difficulty, user.points);
  const [exercise, setExercise] = useState<ExerciseId>('pushup');
  const [difficulty, setDifficulty] = useState<Difficulty>(autoDifficulty);
  const [showPicker, setShowPicker] = useState(false);

  const board = buildLeaderboard(user);
  const rank = board.findIndex((u) => u.id === 'me') + 1;

  const selected = buildQuest(exercise, difficulty);
  const streakLeft = Math.max(STREAK_THRESHOLD - user.pointsToday, 0);

  const shuffle = () => {
    setExercise(EXERCISE_IDS[Math.floor(Math.random() * EXERCISE_IDS.length)]);
    setDifficulty(resolveDifficulty(user.settings.difficulty, user.points));
  };

  return (
    <Screen>
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Kicker>RepQuest</Kicker>
          <Title>Hey, {user.username}</Title>
          <Text style={styles.subtitle}>Ready for today&apos;s quest? Tap start to begin.</Text>
        </View>
        <View style={styles.streakPill}>
          <View style={styles.flameDot} />
          <Text style={styles.streakPillText}>{user.streak}d</Text>
        </View>
      </View>

      <Card style={styles.hero}>
        <Text style={styles.heroKicker}>Today&apos;s quest</Text>
        <Text style={styles.heroTitle}>{questLabel(selected)}</Text>
        <View style={styles.heroMetaRow}>
          <View style={styles.heroBadge}>
            <Text style={styles.heroBadgeText}>{DIFFICULTY_LABEL[difficulty]}</Text>
          </View>
          <Text style={styles.heroPoints}>+{selected.points} pts</Text>
        </View>

        <Pressable style={styles.startBtn} onPress={() => startQuest(selected)}>
          <Text style={styles.startBtnText}>Start workout</Text>
        </Pressable>

        <View style={styles.heroLinks}>
          <Pressable hitSlop={8} onPress={() => setShowPicker((s) => !s)}>
            <Text style={styles.linkText}>{showPicker ? 'Hide options' : 'Choose exercise'}</Text>
          </Pressable>
          <Pressable hitSlop={8} onPress={shuffle}>
            <Text style={styles.linkText}>Surprise me</Text>
          </Pressable>
        </View>
      </Card>

      {showPicker ? (
        <Card>
          <Text style={styles.pickerLabel}>Exercise</Text>
          <View style={styles.exerciseRow}>
            {EXERCISE_IDS.map((id) => {
              const active = id === exercise;
              return (
                <Pressable
                  key={id}
                  onPress={() => setExercise(id)}
                  style={[styles.chip, active && styles.chipActive]}>
                  <Text style={[styles.chipText, active && styles.chipTextActive]}>
                    {EXERCISE_CONFIG[id].title}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <Text style={[styles.pickerLabel, styles.pickerLabelSpaced]}>Difficulty</Text>
          <View style={styles.diffRow}>
            {DIFFICULTIES.map((d) => {
              const active = d === difficulty;
              const q = buildQuest(exercise, d);
              return (
                <Pressable
                  key={d}
                  onPress={() => setDifficulty(d)}
                  style={[styles.diffChip, active && styles.diffChipActive]}>
                  <Text style={[styles.diffChipText, active && styles.diffChipTextActive]}>
                    {DIFFICULTY_LABEL[d]}
                  </Text>
                  <Text style={[styles.diffChipPts, active && styles.diffChipTextActive]}>
                    {q.target} reps · +{q.points}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </Card>
      ) : null}

      <View style={styles.statRow}>
        <StatCard value={user.points.toLocaleString()} label="Points" />
        <StatCard value={`${user.streak}d`} label="Streak" />
        <StatCard value={`#${rank}`} label="Global" />
      </View>

      <Card>
        <View style={styles.todayRow}>
          <Text style={styles.todayValue}>{user.pointsToday} pts today</Text>
          {streakLeft > 0 ? (
            <Text style={styles.todayNote}>{streakLeft} more to keep your streak</Text>
          ) : (
            <Text style={[styles.todayNote, { color: Brand.good }]}>Streak secured today</Text>
          )}
        </View>
        <View style={styles.progressTrack}>
          <View
            style={[
              styles.progressFill,
              { width: `${Math.min(user.pointsToday / STREAK_THRESHOLD, 1) * 100}%` },
            ]}
          />
        </View>
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 12,
  },
  headerText: { flex: 1, gap: 2 },
  subtitle: { color: Brand.textSecondary, fontSize: 14, marginTop: 4 },
  streakPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: Brand.radiusPill,
    backgroundColor: Brand.accentMuted,
    borderWidth: 1,
    borderColor: 'rgba(224, 99, 69, 0.35)',
  },
  flameDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: Brand.accent },
  streakPillText: { color: Brand.text, fontSize: 12, fontWeight: '700' },

  hero: { gap: 0 },
  heroKicker: {
    fontFamily: Fonts.mono,
    fontSize: 12,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    color: Brand.accent,
    fontWeight: '700',
  },
  heroTitle: { color: Brand.text, fontSize: 30, lineHeight: 36, fontWeight: '800', marginTop: 8 },
  heroMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 8 },
  heroBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: Brand.radiusPill,
    backgroundColor: Brand.bgElevated,
    borderWidth: 1,
    borderColor: Brand.border,
  },
  heroBadgeText: { color: Brand.text, fontSize: 12, fontWeight: '700' },
  heroPoints: { fontFamily: Fonts.mono, color: Brand.textSecondary, fontSize: 13, fontWeight: '700' },

  startBtn: {
    marginTop: 18,
    paddingVertical: 16,
    borderRadius: Brand.radius,
    backgroundColor: Brand.accent,
    alignItems: 'center',
  },
  startBtnText: { color: '#fff', fontSize: 16, fontWeight: '800' },
  heroLinks: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 14 },
  linkText: { color: Brand.textSecondary, fontSize: 13, fontWeight: '700' },

  pickerLabel: {
    color: Brand.textTertiary,
    fontSize: 11,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  pickerLabelSpaced: { marginTop: 16 },
  exerciseRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: Brand.radius,
    backgroundColor: Brand.bgElevated,
    borderWidth: 1,
    borderColor: Brand.border,
  },
  chipActive: { backgroundColor: Brand.accentMuted, borderColor: Brand.accent },
  chipText: { color: Brand.textSecondary, fontSize: 13, fontWeight: '600' },
  chipTextActive: { color: Brand.text },

  diffRow: { flexDirection: 'row', gap: 8 },
  diffChip: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 10,
    borderRadius: Brand.radius,
    backgroundColor: Brand.bgElevated,
    borderWidth: 1,
    borderColor: Brand.border,
    gap: 3,
  },
  diffChipActive: { backgroundColor: Brand.accentMuted, borderColor: Brand.accent },
  diffChipText: { color: Brand.textSecondary, fontSize: 14, fontWeight: '700' },
  diffChipTextActive: { color: Brand.text },
  diffChipPts: { color: Brand.textTertiary, fontSize: 11 },

  statRow: { flexDirection: 'row', gap: 10 },

  todayRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 },
  todayValue: { fontFamily: Fonts.mono, color: Brand.text, fontSize: 16, fontWeight: '700' },
  todayNote: { color: Brand.textSecondary, fontSize: 12 },
  progressTrack: { height: 6, borderRadius: 3, backgroundColor: Brand.bgElevated, overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: 3, backgroundColor: Brand.accent },
});
