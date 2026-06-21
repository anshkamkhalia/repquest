import * as Haptics from 'expo-haptics';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Linking, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTensorflowModel } from 'react-native-fast-tflite';
import {
  Delegate,
  MediapipeCamera,
  RunningMode,
  usePoseDetection,
  type DetectionError,
  type PoseDetectionResultBundle,
} from 'react-native-mediapipe';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Camera, useCameraDevice, type CameraPermissionStatus } from 'react-native-vision-camera';

import { Brand, Overlay } from '@/constants/brand';
import { Fonts } from '@/constants/theme';
import {
  DIFFICULTIES,
  DIFFICULTY_LABEL,
  EXERCISE_CONFIG,
  EXERCISE_IDS,
  STREAK_THRESHOLD,
  buildQuest,
  type Difficulty,
  type ExerciseId,
} from '@/constants/workout-rules';
import {
  CLASS_LABEL,
  GOOD_LABEL,
  IssueTracker,
  QualityBuffer,
  decodeQuality,
  extractFeatures,
  flattenWindow,
  type QualityExerciseId,
  type QualityResult,
} from '@/lib/exercise-model';
import { RepCounter, poseVisible, type Landmark, type RepExerciseId } from '@/lib/pose-analysis';
import { useUser, type QuestResult } from '@/lib/user-context';

// Same .task file the Python pipeline and the web build use, bundled as a
// native resource by plugins/withPoseLandmarkerModel.js (react-native-mediapipe
// resolves it via Bundle.main on iOS / assets/ on Android, by filename).
const POSE_MODEL_FILE = 'pose_landmarker_full.task';

// Trained quality classifiers (pushup/lunge only — final.py skips squat's).
const QUALITY_MODEL_ASSETS: Record<QualityExerciseId, number> = {
  pushup: require('../../tflite_models/pushup.tflite'),
  lunge: require('../../tflite_models/lunge.tflite'),
};

function isQualityExercise(ex: ExerciseId): ex is QualityExerciseId {
  return ex === 'pushup' || ex === 'lunge';
}

type Phase = 'active' | 'success' | 'rejected';

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
  const [permissionStatus, setPermissionStatus] = useState<CameraPermissionStatus>(() =>
    Camera.getCameraPermissionStatus(),
  );
  const hasPermission = permissionStatus === 'granted';
  // Simulators have no physical camera, so this is `undefined` there even
  // with permission granted — surface that distinctly instead of silently
  // showing nothing (MediapipeCamera's own fallback is just blank text).
  const device = useCameraDevice('front');

  const [count, setCount] = useState(0);
  const [feedback, setFeedback] = useState<string>(config.messages.idle);
  const [feedbackTone, setFeedbackTone] = useState<'idle' | 'good' | 'bad'>('idle');
  const [phase, setPhase] = useState<Phase>('active');
  const [result, setResult] = useState<QuestResult | null>(null);
  const [mostCommonIssue, setMostCommonIssue] = useState<string | null>(null);
  const [livePrediction, setLivePrediction] = useState<QualityResult | null>(null);

  const counterRef = useRef(new RepCounter(exercise as RepExerciseId));
  const qualityBufferRef = useRef(new QualityBuffer());
  const issueTrackerRef = useRef(new IssueTracker());
  const finishedRef = useRef(false);

  // `exercise` is fixed for this screen's lifetime (workout.tsx remounts on a
  // new quest — see its key prop), so it's fine to always load some model
  // here; for squat (no quality model) it's simply never run.
  const qualityModelAsset = QUALITY_MODEL_ASSETS[isQualityExercise(exercise) ? exercise : 'pushup'];
  const tflite = useTensorflowModel(qualityModelAsset, []);

  // The OS only shows the native permission dialog once — after a deny, it
  // won't pop up again no matter how many times requestPermission() is
  // called. So: auto-request only while truly undetermined, and otherwise
  // re-check status whenever the app regains focus, so the prompt clears
  // itself the moment the user flips it on in Settings and comes back,
  // without needing to relaunch the app.
  useEffect(() => {
    if (permissionStatus === 'not-determined') {
      Camera.requestCameraPermission().then((result) =>
        setPermissionStatus(result === 'granted' ? 'granted' : 'denied'),
      );
    }
  }, [permissionStatus]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') setPermissionStatus(Camera.getCameraPermissionStatus());
    });
    return () => subscription.remove();
  }, []);

  const onPermissionPress = useCallback(() => {
    if (permissionStatus === 'denied' || permissionStatus === 'restricted') {
      Linking.openSettings();
    } else {
      Camera.requestCameraPermission().then((result) =>
        setPermissionStatus(result === 'granted' ? 'granted' : 'denied'),
      );
    }
  }, [permissionStatus]);

  const reached = count >= quest.target;
  const accent =
    phase === 'success'
      ? Brand.good
      : phase === 'rejected'
        ? Brand.bad
        : feedbackTone === 'bad'
          ? Brand.warn
          : reached
            ? Brand.good
            : feedbackTone === 'good'
              ? Brand.good
              : Brand.textSecondary;

  const finish = useCallback(
    (didReach: boolean) => {
      if (finishedRef.current) return;
      finishedRef.current = true;
      if (isQualityExercise(exercise)) {
        setMostCommonIssue(issueTrackerRef.current.mostCommonIssue());
      }
      if (didReach) {
        const res = completeQuest(quest.points);
        setResult(res);
        setPhase('success');
        haptic('success');
      } else {
        setPhase('rejected');
        haptic('error');
      }
    },
    [completeQuest, quest.points, exercise],
  );

  const runQualityInference = useCallback(
    async (ex: QualityExerciseId, window: Float32Array[]) => {
      if (tflite.state !== 'loaded') return;
      try {
        const outputs = await tflite.model.run([flattenWindow(window).buffer as ArrayBuffer]);
        const data = new Float32Array(outputs[0]);
        const quality = decodeQuality(ex, data);
        issueTrackerRef.current.record(quality.label, GOOD_LABEL[ex]);
        console.log(
          `[quality:${ex}]`,
          quality.label,
          `${(quality.confidence * 100).toFixed(1)}%`,
          '—',
          quality.probs.map((p) => `${p.label}=${(p.prob * 100).toFixed(1)}%`).join(' '),
        );
        setLivePrediction(quality);
        setFeedback(quality.message || config.messages[quality.good ? 'correct' : 'incorrect']);
        setFeedbackTone(quality.good ? 'good' : 'bad');
      } catch (err) {
        console.error(`[quality:${ex}] inference failed`, err);
      }
    },
    [tflite, config.messages],
  );

  const onResults = useCallback(
    (result: PoseDetectionResultBundle) => {
      if (finishedRef.current) return;
      const landmarks = result.results[0]?.landmarks?.[0] as Landmark[] | undefined;
      if (!landmarks || !poseVisible(landmarks)) {
        setFeedback('Step back so your whole body is in frame');
        setFeedbackTone('idle');
        return;
      }

      const update = counterRef.current.update(landmarks);
      if (update.repCompleted) {
        setCount(update.reps);
        // For pushup/lunge the trained quality model owns the feedback text
        // (updates independently every SEQ_LEN frames, same as final.py's
        // last_feedback). Squat has no model, so it keeps the geometric form
        // message final.py also falls back to.
        if (!isQualityExercise(exercise)) {
          if (update.formBad) {
            setFeedback(update.message ?? config.messages.incorrect);
            setFeedbackTone('bad');
          } else {
            setFeedback(config.messages.correct);
            setFeedbackTone('good');
          }
        }
        haptic(update.formBad ? 'warn' : update.reps >= quest.target ? 'success' : 'rep');
        if (update.reps >= quest.target) finish(true);
      }

      if (isQualityExercise(exercise)) {
        const window = qualityBufferRef.current.push(extractFeatures(landmarks));
        if (window) void runQualityInference(exercise, window);
      }
    },
    [exercise, quest.target, config.messages, finish, runQualityInference],
  );

  const onError = useCallback((error: DetectionError) => {
    console.error('[pose] detection error', error);
  }, []);

  const poseDetection = usePoseDetection({ onResults, onError }, RunningMode.LIVE_STREAM, POSE_MODEL_FILE, {
    delegate: Delegate.GPU,
    numPoses: 1,
    minPoseDetectionConfidence: 0.5,
    minPosePresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
  });

  const onDone = useCallback(() => {
    if (phase !== 'active') return;
    finish(count >= quest.target);
  }, [phase, count, quest.target, finish]);

  const onTryAgain = useCallback(() => {
    counterRef.current = new RepCounter(exercise as RepExerciseId);
    qualityBufferRef.current = new QualityBuffer();
    issueTrackerRef.current = new IssueTracker();
    finishedRef.current = false;
    setCount(0);
    setFeedback(config.messages.idle);
    setFeedbackTone('idle');
    setResult(null);
    setMostCommonIssue(null);
    setLivePrediction(null);
    setPhase('active');
  }, [exercise, config.messages]);

  const progress = Math.min(count / quest.target, 1);

  const headlineLabel =
    phase === 'success'
      ? 'SUCCESS'
      : phase === 'rejected'
        ? 'REJECTED'
        : feedbackTone === 'bad'
          ? 'FORM'
          : reached
            ? 'DONE'
            : feedbackTone === 'good'
              ? 'GOOD'
              : 'READY';

  const headline =
    phase === 'success'
      ? 'Quest complete'
      : phase === 'rejected'
        ? 'Not enough reps'
        : reached
          ? 'Target hit'
          : feedback;

  const showIssueCard = phase !== 'active' && isQualityExercise(exercise);

  return (
    <View style={styles.root}>
      {hasPermission && device ? (
        <MediapipeCamera style={StyleSheet.absoluteFill} solution={poseDetection} resizeMode="cover" />
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
            <View style={[styles.statusDot, { backgroundColor: accent }]} />
            <Text style={styles.statusChipText}>
              {config.title} · {DIFFICULTY_LABEL[difficulty]}
            </Text>
          </View>
          <Pressable style={styles.closeBtn} onPress={() => router.back()}>
            <Text style={styles.closeBtnText}>Close</Text>
          </Pressable>
        </View>

        {!hasPermission ? (
          <Pressable style={styles.camPrompt} onPress={onPermissionPress}>
            <Text style={styles.camPromptText}>
              {permissionStatus === 'denied' || permissionStatus === 'restricted'
                ? 'Camera access denied — tap to open Settings and enable it'
                : 'Enable front camera for live form tracking'}
            </Text>
          </Pressable>
        ) : !device ? (
          <View style={styles.camPrompt}>
            <Text style={styles.camPromptText}>
              No camera found — this is expected on the iOS Simulator. Run on a physical device to
              test the camera.
            </Text>
          </View>
        ) : (
          <View style={styles.feedbackWrap}>
            <View style={[styles.feedbackCard, { borderColor: accent, shadowColor: accent }]}>
              <Text style={[styles.feedbackLabel, { color: accent }]}>{headlineLabel}</Text>
              <Text style={styles.feedbackMessage}>{headline}</Text>
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

        {showIssueCard ? (
          <View style={[styles.issueCard, mostCommonIssue ? styles.issueCardWarn : styles.issueCardGood]}>
            <Text style={[styles.issueKicker, { color: mostCommonIssue ? Brand.warn : Brand.good }]}>
              {mostCommonIssue ? 'Most common issue' : 'Form check'}
            </Text>
            <Text style={styles.issueValue}>
              {mostCommonIssue ? CLASS_LABEL[mostCommonIssue] ?? mostCommonIssue : 'Clean form the whole set!'}
            </Text>
          </View>
        ) : null}

        {phase === 'active' && isQualityExercise(exercise) && livePrediction ? (
          <View style={styles.liveCard}>
            <Text style={styles.liveKicker}>Model output (live)</Text>
            {livePrediction.probs.map((p) => {
              const isTop = p.label === livePrediction.label;
              return (
                <View key={p.label} style={styles.liveRow}>
                  <Text style={[styles.liveRowLabel, isTop && styles.liveRowLabelActive]} numberOfLines={1}>
                    {CLASS_LABEL[p.label] ?? p.label}
                  </Text>
                  <View style={styles.liveBarTrack}>
                    <View
                      style={[
                        styles.liveBarFill,
                        {
                          width: `${Math.round(p.prob * 100)}%`,
                          backgroundColor: isTop ? (livePrediction.good ? Brand.good : Brand.warn) : Brand.borderStrong,
                        },
                      ]}
                    />
                  </View>
                  <Text style={styles.livePct}>{Math.round(p.prob * 100)}%</Text>
                </View>
              );
            })}
          </View>
        ) : null}

        <View style={styles.bottomCard}>
          <View style={styles.repRow}>
            <Text style={styles.repCount}>{count}</Text>
            <Text style={styles.repTarget}>/ {quest.target} reps</Text>
          </View>
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${progress * 100}%`, backgroundColor: accent }]} />
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
              <Pressable style={styles.primaryBtn} onPress={onTryAgain}>
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
  feedbackPoints: { fontFamily: Fonts.mono, color: Brand.accent, fontSize: 15, fontWeight: '700', marginTop: 2 },
  rejectText: { color: Brand.textSecondary, fontSize: 13, textAlign: 'center', marginTop: 2 },

  issueCard: {
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderRadius: Brand.radiusLg,
    borderWidth: 1.5,
  },
  issueCardWarn: { backgroundColor: 'rgba(224, 99, 69, 0.14)', borderColor: Brand.warn },
  issueCardGood: { backgroundColor: 'rgba(90, 154, 130, 0.14)', borderColor: Brand.good },
  issueKicker: { fontFamily: Fonts.mono, fontSize: 11, letterSpacing: 1.5, textTransform: 'uppercase', fontWeight: '800' },
  issueValue: { color: Brand.text, fontSize: 17, fontWeight: '800', textAlign: 'center' },

  liveCard: {
    gap: 10,
    paddingHorizontal: 18,
    paddingVertical: 16,
    borderRadius: Brand.radiusLg,
    backgroundColor: Overlay.card,
    borderWidth: 1,
    borderColor: Overlay.hairline,
  },
  liveKicker: {
    fontFamily: Fonts.mono,
    fontSize: 11,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    color: Brand.textTertiary,
    fontWeight: '700',
  },
  liveRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  liveRowLabel: { width: 116, color: Brand.textSecondary, fontSize: 12, fontWeight: '600' },
  liveRowLabelActive: { color: Brand.text, fontWeight: '800' },
  liveBarTrack: { flex: 1, height: 8, borderRadius: 4, backgroundColor: 'rgba(236, 233, 226, 0.1)', overflow: 'hidden' },
  liveBarFill: { height: '100%', borderRadius: 4 },
  livePct: { width: 38, textAlign: 'right', fontFamily: Fonts.mono, color: Brand.textSecondary, fontSize: 12 },

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
