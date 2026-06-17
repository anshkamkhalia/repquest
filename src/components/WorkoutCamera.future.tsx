import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  Vibration,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  Camera,
  useCameraDevice,
  useCameraPermission,
  useFrameProcessor,
} from 'react-native-vision-camera';
import { useTensorflowModel } from 'react-native-fast-tflite';

import { Brand, Overlay } from '@/constants/brand';
import { Fonts } from '@/constants/theme';

/* ───────────────────────── Feedback rule architecture ─────────────────────────
 * Your .tflite models classify MediaPipe pose landmarks (see src/rep_counter.py),
 * NOT raw pixels. The `labels` arrays below MUST match the output order your
 * models were trained with. `argmax(output) -> label -> status`.
 * ----------------------------------------------------------------------------- */

export type ExerciseId = 'pushup' | 'squat' | 'lunge' | 'plank';

export type FeedbackStatus = 'idle' | 'correct' | 'incorrect' | 'reset';

type ExerciseRule = {
  title: string;
  /** Output classes in the exact order the model emits them. */
  labels: string[];
  /** The single label that counts as good form. */
  correctLabel: string;
  /** Labels that should trigger a hard reset + audio cue (plank position lost). */
  resetLabels?: string[];
  /** Human-friendly coaching copy per label. */
  messages: Record<string, string>;
};

const EXERCISE_RULES: Record<ExerciseId, ExerciseRule> = {
  pushup: {
    title: 'Push-ups',
    labels: ['partial', 'low_hip', 'high_hip', 'good'],
    correctLabel: 'good',
    messages: {
      partial: 'Go deeper — full range of motion',
      low_hip: 'Hips sagging — brace your core',
      high_hip: 'Hips too high — flatten your back',
      good: 'Clean rep',
    },
  },
  squat: {
    title: 'Squats',
    labels: ['partial', 'legs_too_close', 'good'],
    correctLabel: 'good',
    messages: {
      partial: 'Drop lower — hit depth',
      legs_too_close: 'Widen your stance',
      good: 'Clean rep',
    },
  },
  lunge: {
    title: 'Lunges',
    labels: ['partial', 'angled_back', 'good'],
    correctLabel: 'good',
    messages: {
      partial: 'Deeper — front knee to 90°',
      angled_back: 'Keep your torso upright',
      good: 'Clean rep',
    },
  },
  plank: {
    title: 'Plank',
    labels: ['lost', 'good'],
    correctLabel: 'good',
    resetLabels: ['lost'],
    messages: {
      lost: 'Position lost — reset',
      good: 'Hold steady',
    },
  },
};

/** Static requires so Metro can bundle each .tflite model. */
const MODELS = {
  pushup: require('../../tflite_models/pushup.tflite'),
  squat: require('../../tflite_models/squat.tflite'),
  lunge: require('../../tflite_models/lunge.tflite'),
  // No dedicated plank model yet — reuse pushup graph as a placeholder.
  plank: require('../../tflite_models/pushup.tflite'),
} as const;

type FeedbackState = {
  status: FeedbackStatus;
  label: string | null;
  message: string;
};

const IDLE_FEEDBACK: FeedbackState = {
  status: 'idle',
  label: null,
  message: 'Get in frame to begin',
};

/** argmax of a probability vector. */
function argmax(values: ArrayLike<number>): number {
  let best = 0;
  let bestVal = -Infinity;
  for (let i = 0; i < values.length; i += 1) {
    if (values[i] > bestVal) {
      bestVal = values[i];
      best = i;
    }
  }
  return best;
}

/** Map a raw model output vector to a feedback state for the given exercise. */
function classifyOutput(exercise: ExerciseId, output: ArrayLike<number>): FeedbackState {
  const rule = EXERCISE_RULES[exercise];
  const idx = argmax(output);
  const label = rule.labels[idx] ?? 'partial';
  const message = rule.messages[label] ?? '';

  if (rule.resetLabels?.includes(label)) {
    return { status: 'reset', label, message };
  }
  return {
    status: label === rule.correctLabel ? 'correct' : 'incorrect',
    label,
    message,
  };
}

type WorkoutCameraProps = {
  exercise?: ExerciseId;
  /** Reps to complete this set (drives the counter UI). */
  targetReps?: number;
  onComplete?: () => void;
};

export function WorkoutCamera({
  exercise = 'pushup',
  targetReps = 10,
  onComplete,
}: WorkoutCameraProps) {
  const { hasPermission, requestPermission } = useCameraPermission();
  const device = useCameraDevice('front');

  // Loads the bundled .tflite graph for the active exercise.
  const model = useTensorflowModel(MODELS[exercise]);

  const [reps, setReps] = useState(0);
  const [feedback, setFeedback] = useState<FeedbackState>(IDLE_FEEDBACK);
  const lastRepPhase = useRef<'up' | 'down'>('up');

  useEffect(() => {
    if (!hasPermission) requestPermission();
  }, [hasPermission, requestPermission]);

  // Reset session whenever the exercise changes.
  useEffect(() => {
    setReps(0);
    setFeedback(IDLE_FEEDBACK);
    lastRepPhase.current = 'up';
  }, [exercise]);

  const playResetCue = useCallback(() => {
    // TODO(audio): swap for expo-audio / expo-haptics cue. Vibration is a stand-in.
    Vibration.vibrate(200);
  }, []);

  /**
   * Entry point for inference results. The frame processor (once a pose-landmark
   * step is wired in) should forward the model output here on the JS thread.
   */
  const applyModelOutput = useCallback(
    (output: ArrayLike<number>) => {
      const next = classifyOutput(exercise, output);
      setFeedback(next);

      if (next.status === 'reset') {
        playResetCue();
        lastRepPhase.current = 'up';
        return;
      }

      // Minimal up/down rep state machine — counts a rep on each good cycle.
      if (exercise !== 'plank' && next.status === 'correct') {
        if (lastRepPhase.current === 'up') {
          lastRepPhase.current = 'down';
        }
      } else if (next.status === 'incorrect' && lastRepPhase.current === 'down') {
        lastRepPhase.current = 'up';
        setReps((prev) => {
          const updated = prev + 1;
          if (updated >= targetReps) onComplete?.();
          return updated;
        });
      }
    },
    [exercise, targetReps, onComplete, playResetCue],
  );

  // Keep applyModelOutput referenced until the real-time path calls it,
  // so the wiring is obvious and lint stays clean.
  void applyModelOutput;

  /* ─────────────────────────── Frame processor ───────────────────────────
   * Real-time hook. To finish the pipeline:
   *   1. Run a pose detector on `frame` (e.g. a Vision Camera MediaPipe plugin)
   *      to get normalized landmarks: number[] of shape [33 * 3].
   *   2. const out = model.model?.runSync([landmarksFloat32])[0];
   *   3. Forward `out` to applyModelOutput via a worklets runOnJS bridge.
   * Left as a no-op worklet so the build compiles and the camera runs now.
   * --------------------------------------------------------------------- */
  const frameProcessor = useFrameProcessor((frame) => {
    'worklet';
    // eslint-disable-next-line @typescript-eslint/no-unused-expressions
    frame; // placeholder: pose landmarks → model.runSync → runOnJS(applyModelOutput)
  }, []);

  const rule = EXERCISE_RULES[exercise];
  const accentForStatus = useMemo(() => {
    switch (feedback.status) {
      case 'correct':
        return Brand.good;
      case 'incorrect':
        return Brand.bad;
      case 'reset':
        return Brand.warn;
      default:
        return Brand.textSecondary;
    }
  }, [feedback.status]);

  // ── Permission / device gates ──────────────────────────────────────────
  if (!hasPermission) {
    return (
      <View style={styles.gate}>
        <SafeAreaView style={styles.gateInner}>
          <Text style={styles.gateKicker}>CAMERA ACCESS</Text>
          <Text style={styles.gateTitle}>RepQuest needs your camera</Text>
          <Text style={styles.gateBody}>
            We analyze your form on-device, in real time. Frames never leave your phone.
          </Text>
          <Pressable style={styles.primaryBtn} onPress={requestPermission}>
            <Text style={styles.primaryBtnText}>Enable camera</Text>
          </Pressable>
        </SafeAreaView>
      </View>
    );
  }

  if (device == null) {
    return (
      <View style={styles.gate}>
        <SafeAreaView style={styles.gateInner}>
          <ActivityIndicator color={Brand.accent} />
          <Text style={styles.gateBody}>No front camera found on this device.</Text>
        </SafeAreaView>
      </View>
    );
  }

  const repProgress = Math.min(reps / targetReps, 1);

  return (
    <View style={styles.root}>
      <Camera
        style={StyleSheet.absoluteFill}
        device={device}
        isActive
        frameProcessor={frameProcessor}
      />

      {/* Top + bottom scrims keep text legible over any background */}
      <View style={[styles.scrim, styles.scrimTop]} pointerEvents="none" />
      <View style={[styles.scrim, styles.scrimBottom]} pointerEvents="none" />

      <SafeAreaView style={styles.overlay} pointerEvents="box-none">
        {/* Status chip — floating pill, not a full-width bar */}
        <View style={styles.topRow} pointerEvents="box-none">
          <View style={styles.statusChip}>
            <View style={[styles.statusDot, { backgroundColor: accentForStatus }]} />
            <Text style={styles.statusChipText}>{rule.title}</Text>
          </View>
          {model.state === 'loading' ? (
            <View style={styles.statusChip}>
              <ActivityIndicator size="small" color={Brand.accent} />
              <Text style={styles.statusChipText}>Loading model</Text>
            </View>
          ) : null}
        </View>

        {/* Center coaching card — semi-transparent, accent-edged */}
        <View style={styles.feedbackWrap} pointerEvents="box-none">
          <View
            style={[
              styles.feedbackCard,
              { borderColor: accentForStatus, shadowColor: accentForStatus },
            ]}>
            <Text style={[styles.feedbackLabel, { color: accentForStatus }]}>
              {feedback.status === 'idle' ? 'READY' : feedback.status.toUpperCase()}
            </Text>
            <Text style={styles.feedbackMessage}>{feedback.message}</Text>
          </View>
        </View>

        {/* Bottom HUD — rep counter + thin progress, generous breathing room */}
        <View style={styles.bottomCard} pointerEvents="box-none">
          {exercise === 'plank' ? (
            <Text style={styles.plankHint}>Hold the position</Text>
          ) : (
            <View style={styles.repRow}>
              <Text style={styles.repCount}>{reps}</Text>
              <Text style={styles.repTarget}>/ {targetReps} reps</Text>
            </View>
          )}
          <View style={styles.progressTrack}>
            <View
              style={[
                styles.progressFill,
                { width: `${repProgress * 100}%` },
              ]}
            />
          </View>
        </View>
      </SafeAreaView>
    </View>
  );
}

export default WorkoutCamera;

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: Brand.bg,
  },
  overlay: {
    flex: 1,
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 12,
  },

  // Scrims
  scrim: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 180,
    backgroundColor: Overlay.scrim,
  },
  scrimTop: { top: 0 },
  scrimBottom: { bottom: 0, height: 220 },

  // Top row
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 10,
  },
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
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  statusChipText: {
    color: Brand.text,
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: 0.2,
  },

  // Center feedback
  feedbackWrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  feedbackCard: {
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 26,
    paddingVertical: 18,
    borderRadius: Brand.radiusLg,
    backgroundColor: Overlay.cardStrong,
    borderWidth: 1.5,
    maxWidth: 320,
    // Soft accent glow — handcrafted, not a hard box
    shadowOpacity: 0.5,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  feedbackLabel: {
    fontFamily: Fonts.mono,
    fontSize: 12,
    letterSpacing: 2,
    fontWeight: '700',
  },
  feedbackMessage: {
    color: Brand.text,
    fontSize: 18,
    lineHeight: 24,
    fontWeight: '600',
    textAlign: 'center',
  },

  // Bottom HUD
  bottomCard: {
    gap: 14,
    paddingHorizontal: 22,
    paddingVertical: 20,
    borderRadius: Brand.radiusLg,
    backgroundColor: Overlay.card,
    borderWidth: 1,
    borderColor: Overlay.hairline,
  },
  repRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 10,
  },
  repCount: {
    fontFamily: Fonts.mono,
    color: Brand.text,
    fontSize: 52,
    lineHeight: 54,
    fontWeight: '700',
  },
  repTarget: {
    color: Brand.textSecondary,
    fontSize: 16,
    fontWeight: '600',
    paddingBottom: 6,
  },
  plankHint: {
    color: Brand.text,
    fontSize: 18,
    fontWeight: '600',
  },
  progressTrack: {
    height: 6,
    borderRadius: 3,
    backgroundColor: 'rgba(236, 233, 226, 0.14)',
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 3,
    backgroundColor: Brand.accent,
  },

  // Permission / device gate
  gate: {
    flex: 1,
    backgroundColor: Brand.bg,
  },
  gateInner: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
    paddingHorizontal: 32,
  },
  gateKicker: {
    fontFamily: Fonts.mono,
    color: Brand.accent,
    fontSize: 12,
    letterSpacing: 2,
    fontWeight: '700',
  },
  gateTitle: {
    color: Brand.text,
    fontSize: 26,
    fontWeight: '700',
    textAlign: 'center',
  },
  gateBody: {
    color: Brand.textSecondary,
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
  },
  primaryBtn: {
    marginTop: 10,
    paddingHorizontal: 26,
    paddingVertical: 14,
    borderRadius: Brand.radius,
    backgroundColor: Brand.accent,
  },
  primaryBtnText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '700',
  },
});
