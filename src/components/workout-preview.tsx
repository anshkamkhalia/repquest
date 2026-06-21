import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Brand, Overlay } from '@/constants/brand';
import { Fonts } from '@/constants/theme';
import {
  DIFFICULTIES,
  DIFFICULTY_LABEL,
  EXERCISE_CONFIG,
  EXERCISE_IDS,
  buildQuest,
  type Difficulty,
  type ExerciseId,
  type FeedbackStatus,
} from '@/constants/workout-rules';
import { STREAK_THRESHOLD } from '@/constants/workout-rules';
import { useUser, type QuestResult } from '@/lib/user-context';

const REP_TICK_MS = 1100;

type Phase = 'active' | 'success' | 'rejected';

function statusColor(status: FeedbackStatus): string {
  switch (status) {
    case 'correct':
      return Brand.good;
    case 'incorrect':
      return Brand.bad;
    default:
      return Brand.textSecondary;
  }
}

// Weighted random "prediction" standing in for the on-device model output.
// TODO: replace with real on-device pose detection + tflite inference (see
// the web build's workout-preview.web.tsx for the real pipeline this mirrors).
function predict(): FeedbackStatus {
  return Math.random() < 0.7 ? 'correct' : 'incorrect';
}

function asExercise(value: string | string[] | undefined): ExerciseId {
  const v = Array.isArray(value) ? value[0] : value;
  return EXERCISE_IDS.includes(v as ExerciseId) ? (v as ExerciseId) : 'pushup';
}

function asDifficulty(value: string | string[] | undefined): Difficulty {
  const v = Array.isArray(value) ? value[0] : value;
  return DIFFICULTIES.includes(v as Difficulty) ? (v as Difficulty) : 'medium';
}

function haptic(type: 'rep' | 'success' | 'warn' | 'error') {
  try {
    if (type === 'rep') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    else if (type === 'success') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    else if (type === 'warn') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    else Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
  } catch {
    // haptics are best-effort
  }
}

export function WorkoutPreview() {
  const params = useLocalSearchParams<{ exercise?: string; difficulty?: string; quest?: string }>();
  const exercise = asExercise(params.exercise);
  const difficulty = asDifficulty(params.difficulty);
  const quest = useMemo(() => buildQuest(exercise, difficulty), [exercise, difficulty]);
  const config = EXERCISE_CONFIG[exercise];

  const { completeQuest } = useUser();
  const [permission, requestPermission] = useCameraPermissions();
  const [cameraReady, setCameraReady] = useState(false);

  const [count, setCount] = useState(0);
  const [status, setStatus] = useState<FeedbackStatus>('idle');
  const [tip, setTip] = useState<string | null>(null);
  const [running, setRunning] = useState(true);
  const [phase, setPhase] = useState<Phase>('active');
  const [result, setResult] = useState<QuestResult | null>(null);

  const accent = statusColor(status);
  const reached = count >= quest.target;

  useEffect(() => {
    setCameraReady(true);
  }, []);

  const pickTip = useCallback(() => {
    setTip(config.tips[Math.floor(Math.random() * config.tips.length)]);
  }, [config.tips]);

  // Drive the simulated model output.
  useEffect(() => {
    if (phase !== 'active' || !running) return undefined;

    const id = setInterval(() => {
      const next = predict();
      setStatus(next);
      if (next === 'correct') {
        setTip(null);
        setCount((prev) => {
          if (prev >= quest.target) return prev;
          const updated = prev + 1;
          haptic(updated >= quest.target ? 'success' : 'rep');
          return updated;
        });
      } else {
        pickTip();
      }
    }, REP_TICK_MS);
    return () => clearInterval(id);
  }, [phase, running, quest.target, pickTip]);

  const onDone = useCallback(() => {
    if (phase !== 'active') return;
    if (count >= quest.target) {
      const res = completeQuest(quest.points);
      setResult(res);
      setPhase('success');
      haptic('success');
    } else {
      setPhase('rejected');
      haptic('error');
    }
    setRunning(false);
  }, [phase, count, quest.target, quest.points, completeQuest]);

  const progress = Math.min(count / quest.target, 1);

  const headline =
    phase === 'success'
      ? 'Quest complete'
      : phase === 'rejected'
        ? 'Not enough reps'
        : reached
          ? 'Target hit — press done'
          : config.messages[status];

  const headlineLabel =
    phase === 'success' ? 'SUCCESS' : phase === 'rejected' ? 'REJECTED' : status === 'idle' ? 'READY' : status.toUpperCase();

  const headlineColor =
    phase === 'success' ? Brand.good : phase === 'rejected' ? Brand.bad : reached ? Brand.good : accent;

  const showCamPrompt = cameraReady && !permission?.granted;

  return (
    <View style={styles.root}>
      {cameraReady && permission?.granted ? (
        <CameraView style={StyleSheet.absoluteFill} facing="front" />
      ) : (
        <View style={styles.mockFeed}>
          <View style={styles.mockFeedGlow} />
        </View>
      )}

      <View style={[styles.scrim, styles.scrimTop]} pointerEvents="none" />
      <View style={[styles.scrim, styles.scrimBottom]} pointerEvents="none" />

      <SafeAreaView style={styles.overlay} edges={['top', 'bottom']}>
        <View style={styles.topRow}>
          <View style={styles.statusChip}>
            <View style={[styles.statusDot, { backgroundColor: headlineColor }]} />
            <Text style={styles.statusChipText}>
              {config.title} · {DIFFICULTY_LABEL[difficulty]}
            </Text>
          </View>
          <Pressable style={styles.closeBtn} onPress={() => router.back()}>
            <Text style={styles.closeBtnText}>Close</Text>
          </Pressable>
        </View>

        {showCamPrompt ? (
          <Pressable style={styles.camPrompt} onPress={requestPermission}>
            <Text style={styles.camPromptText}>Enable front camera for live form tracking</Text>
          </Pressable>
        ) : (
          <View style={styles.feedbackWrap}>
            <View style={[styles.feedbackCard, { borderColor: headlineColor, shadowColor: headlineColor }]}>
              <Text style={[styles.feedbackLabel, { color: headlineColor }]}>{headlineLabel}</Text>
              <Text style={styles.feedbackMessage}>{headline}</Text>
              {tip && phase === 'active' && !reached ? <Text style={styles.tipText}>Tip: {tip}</Text> : null}
              {phase === 'success' && result ? (
                <Text style={styles.feedbackPoints}>
                  +{result.pointsAdded} pts{result.streakExtended ? ' · streak extended' : ''}
                </Text>
              ) : null}
              {phase === 'rejected' ? (
                <Text style={styles.rejectText}>
                  We only counted {count} of {quest.target} reps. Finish the set to bank it.
                </Text>
              ) : null}
            </View>
          </View>
        )}

        <View style={styles.bottomCard}>
          <View style={styles.repRow}>
            <Text style={styles.repCount}>{count}</Text>
            <Text style={styles.repTarget}>/ {quest.target} reps</Text>
          </View>
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${progress * 100}%`, backgroundColor: headlineColor }]} />
          </View>

          {phase === 'active' && (
            <>
              <Pressable
                style={[styles.doneBtn, reached && styles.doneBtnReady]}
                onPress={onDone}>
                <Text style={[styles.doneBtnText, reached && styles.doneBtnTextReady]}>
                  {reached ? `Finish · +${quest.points} pts` : "I'm done"}
                </Text>
              </Pressable>
              <Text style={styles.doneHint}>
                {reached
                  ? 'Nice work — tap finish to bank your points.'
                  : `${quest.target - count} more reps to earn the points.`}
              </Text>
            </>
          )}

          {phase === 'success' && (
            <>
              {result && !result.streakReady ? (
                <Text style={styles.streakNote}>
                  {STREAK_THRESHOLD - result.pointsToday} more pts today to keep your streak
                </Text>
              ) : null}
              <View style={styles.actionRow}>
                <Pressable style={styles.primaryBtn} onPress={() => router.replace('/')}>
                  <Text style={styles.primaryBtnText}>Back to home</Text>
                </Pressable>
                <Pressable style={styles.ghostBtn} onPress={() => router.replace('/leaderboard')}>
                  <Text style={styles.ghostBtnText}>Leaderboard</Text>
                </Pressable>
              </View>
            </>
          )}

          {phase === 'rejected' && (
            <View style={styles.actionRow}>
              <Pressable
                style={styles.primaryBtn}
                onPress={() => {
                  setCount(0);
                  setStatus('idle');
                  setTip(null);
                  setRunning(true);
                  setPhase('active');
                }}>
                <Text style={styles.primaryBtnText}>Try again</Text>
              </Pressable>
              <Pressable style={styles.ghostBtn} onPress={() => router.back()}>
                <Text style={styles.ghostBtnText}>Quit</Text>
              </Pressable>
            </View>
          )}
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Brand.bg },
  mockFeed: {
    ...StyleSheet.absoluteFill,
    backgroundColor: '#1a1917',
    alignItems: 'center',
    justifyContent: 'center',
  },
  mockFeedGlow: {
    position: 'absolute',
    width: '140%',
    height: '50%',
    top: '25%',
    backgroundColor: 'rgba(224, 99, 69, 0.06)',
    transform: [{ rotate: '-8deg' }],
  },
  scrim: { position: 'absolute', left: 0, right: 0, height: 180, backgroundColor: Overlay.scrim },
  scrimTop: { top: 0 },
  scrimBottom: { bottom: 0, height: 280 },
  overlay: {
    flex: 1,
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 12,
    paddingTop: Platform.select({ web: 84, default: 12 }),
  },

  topRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10 },
  statusChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: Brand.radiusPill,
    backgroundColor: Overlay.card,
    borderWidth: 1,
    borderColor: Overlay.hairline,
  },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  statusChipText: { color: Brand.text, fontSize: 13, fontWeight: '600' },
  closeBtn: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: Brand.radiusPill,
    backgroundColor: Overlay.card,
    borderWidth: 1,
    borderColor: Overlay.hairline,
  },
  closeBtnText: { color: Brand.textSecondary, fontSize: 13, fontWeight: '600' },

  camPrompt: {
    alignSelf: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: Brand.radiusPill,
    backgroundColor: Overlay.card,
    borderWidth: 1,
    borderColor: Overlay.hairline,
  },
  camPromptText: { color: Brand.text, fontSize: 12, fontWeight: '600' },

  feedbackWrap: { alignItems: 'center', justifyContent: 'center' },
  feedbackCard: {
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 26,
    paddingVertical: 18,
    borderRadius: Brand.radiusLg,
    backgroundColor: Overlay.cardStrong,
    borderWidth: 1.5,
    maxWidth: 340,
    shadowOpacity: 0.5,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  feedbackLabel: { fontFamily: Fonts.mono, fontSize: 12, letterSpacing: 2, fontWeight: '700' },
  feedbackMessage: { color: Brand.text, fontSize: 18, lineHeight: 24, fontWeight: '600', textAlign: 'center' },
  tipText: { color: Brand.textSecondary, fontSize: 13, textAlign: 'center', marginTop: 2 },
  feedbackPoints: { fontFamily: Fonts.mono, color: Brand.accent, fontSize: 15, fontWeight: '700', marginTop: 2 },
  rejectText: { color: Brand.textSecondary, fontSize: 13, textAlign: 'center', marginTop: 2 },

  bottomCard: {
    gap: 14,
    paddingHorizontal: 22,
    paddingVertical: 20,
    borderRadius: Brand.radiusLg,
    backgroundColor: Overlay.card,
    borderWidth: 1,
    borderColor: Overlay.hairline,
  },
  repRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 10 },
  repCount: { fontFamily: Fonts.mono, color: Brand.text, fontSize: 52, lineHeight: 54, fontWeight: '700' },
  repTarget: { color: Brand.textSecondary, fontSize: 16, fontWeight: '600', paddingBottom: 6 },
  progressTrack: { height: 6, borderRadius: 3, backgroundColor: 'rgba(236, 233, 226, 0.14)', overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: 3 },
  streakNote: { color: Brand.textSecondary, fontSize: 12, textAlign: 'center' },

  actionRow: { flexDirection: 'row', gap: 10 },
  doneBtn: {
    paddingVertical: 15,
    borderRadius: Brand.radius,
    borderWidth: 1,
    borderColor: Brand.borderStrong,
    alignItems: 'center',
  },
  doneBtnReady: { backgroundColor: Brand.accent, borderColor: Brand.accent },
  doneBtnText: { color: Brand.text, fontSize: 15, fontWeight: '800' },
  doneBtnTextReady: { color: '#fff' },
  doneHint: { color: Brand.textSecondary, fontSize: 12, textAlign: 'center', marginTop: -4 },
  primaryBtn: {
    flex: 1,
    paddingVertical: 13,
    borderRadius: Brand.radius,
    backgroundColor: Brand.accent,
    alignItems: 'center',
  },
  primaryBtnText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  ghostBtn: {
    flex: 1,
    paddingVertical: 13,
    borderRadius: Brand.radius,
    borderWidth: 1,
    borderColor: Brand.borderStrong,
    alignItems: 'center',
  },
  ghostBtnText: { color: Brand.text, fontSize: 14, fontWeight: '700' },
});
