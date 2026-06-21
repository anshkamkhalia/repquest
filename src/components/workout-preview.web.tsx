import {
    Tensor,
    loadAndCompile,
    loadLiteRt,
    type CompiledModel,
} from "@litertjs/core";
import type { PoseLandmarker } from "@mediapipe/tasks-vision";
import { Asset } from "expo-asset";
import * as Haptics from "expo-haptics";
import { router, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Brand, Overlay } from "@/constants/brand";
import { Fonts } from "@/constants/theme";
import {
    DIFFICULTIES,
    DIFFICULTY_LABEL,
    EXERCISE_CONFIG,
    EXERCISE_IDS,
    STREAK_THRESHOLD,
    buildQuest,
    type Difficulty,
    type ExerciseId,
} from "@/constants/workout-rules";
import {
    CLASS_LABEL,
    FEATURE_LEN,
    GOOD_LABEL,
    IssueTracker,
    QualityBuffer,
    SEQ_LEN,
    decodeQuality,
    extractFeatures,
    flattenWindow,
    type QualityExerciseId,
    type QualityResult,
} from "@/lib/exercise-model";
import {
    POSE_CONNECTIONS,
    RepCounter,
    poseVisible,
    type Landmark,
    type RepExerciseId,
} from "@/lib/pose-analysis";
import { useUser, type QuestResult } from "@/lib/user-context";

const VISION_VERSION = "0.10.35";
const VISION_CDN = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VISION_VERSION}/vision_bundle.mjs`;
const WASM_URL = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VISION_VERSION}/wasm`;
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task";

// MediaPipe's bundle uses a runtime dynamic import that Metro can't statically
// bundle, so we load the ESM straight from the CDN. Hidden behind `new Function`
// so the bundler never tries to resolve it.
type VisionModule = typeof import("@mediapipe/tasks-vision");
const loadVision = new Function("url", "return import(url)") as (
  url: string,
) => Promise<VisionModule>;

// Same CDN-loading pattern as the MediaPipe wasm above, pointed at the wasm
// build LiteRT.js ships in its own package (see node_modules/@litertjs/core/wasm).
const LITERT_VERSION = "2.5.2";
const LITERT_WASM_CDN = `https://cdn.jsdelivr.net/npm/@litertjs/core@${LITERT_VERSION}/wasm/`;

// Trained quality classifiers (pushup/lunge only — final.py skips squat's).
const QUALITY_MODEL_ASSETS: Record<QualityExerciseId, number> = {
  pushup: require("../../tflite_models/pushup.tflite"),
  lunge: require("../../tflite_models/lunge.tflite"),
};

function isQualityExercise(ex: ExerciseId): ex is QualityExerciseId {
  return ex === "pushup" || ex === "lunge";
}

let liteRtReady: Promise<unknown> | null = null;
function ensureLiteRt(): Promise<unknown> {
  if (!liteRtReady) liteRtReady = loadLiteRt(LITERT_WASM_CDN);
  return liteRtReady;
}

// Compiled models are cached module-wide so switching exercises (or starting a
// new quest) doesn't recompile the wasm graph every time.
const compiledModels = new Map<QualityExerciseId, Promise<CompiledModel>>();
function getQualityModel(exercise: QualityExerciseId): Promise<CompiledModel> {
  let cached = compiledModels.get(exercise);
  if (!cached) {
    cached = ensureLiteRt().then(async () => {
      const asset = Asset.fromModule(QUALITY_MODEL_ASSETS[exercise]);
      await asset.downloadAsync();
      return loadAndCompile(asset.localUri ?? asset.uri, {
        accelerator: "wasm",
      });
    });
    compiledModels.set(exercise, cached);
  }
  return cached;
}

type Setup = "loading" | "ready" | "denied" | "error";
type Phase = "active" | "success" | "rejected";

function asExercise(value: string | string[] | undefined): ExerciseId {
  const v = Array.isArray(value) ? value[0] : value;
  return EXERCISE_IDS.includes(v as ExerciseId) ? (v as ExerciseId) : "pushup";
}

function asDifficulty(value: string | string[] | undefined): Difficulty {
  const v = Array.isArray(value) ? value[0] : value;
  return DIFFICULTIES.includes(v as Difficulty) ? (v as Difficulty) : "medium";
}

function haptic(type: "rep" | "success" | "warn" | "error") {
  try {
    if (type === "rep") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    else if (type === "success")
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    else if (type === "warn")
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    else Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
  } catch {
    // best-effort
  }
}

export function WorkoutPreview() {
  const params = useLocalSearchParams<{
    exercise?: string;
    difficulty?: string;
    quest?: string;
  }>();
  const exercise = asExercise(params.exercise);
  const difficulty = asDifficulty(params.difficulty);
  const quest = useMemo(
    () => buildQuest(exercise, difficulty),
    [exercise, difficulty],
  );
  const config = EXERCISE_CONFIG[exercise];

  const { completeQuest } = useUser();

  const [setup, setSetup] = useState<Setup>("loading");
  const [setupMessage, setSetupMessage] = useState<string | null>(null);
  const [count, setCount] = useState(0);
  const [feedback, setFeedback] = useState<string>(config.messages.idle);
  const [feedbackTone, setFeedbackTone] = useState<"idle" | "good" | "bad">(
    "idle",
  );
  const [phase, setPhase] = useState<Phase>("active");
  const [result, setResult] = useState<QuestResult | null>(null);
  const [mostCommonIssue, setMostCommonIssue] = useState<string | null>(null);
  const [livePrediction, setLivePrediction] = useState<QualityResult | null>(
    null,
  );
  const [restartKey, setRestartKey] = useState(0);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const landmarkerRef = useRef<PoseLandmarker | null>(null);
  const counterRef = useRef<RepCounter | null>(null);
  const qualityBufferRef = useRef<QualityBuffer | null>(null);
  const qualityModelRef = useRef<CompiledModel | null>(null);
  const issueTrackerRef = useRef<IssueTracker | null>(null);
  const rafRef = useRef<number | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const lastVideoTimeRef = useRef(-1);
  const finishedRef = useRef(false);

  const reached = count >= quest.target;
  const accent =
    phase === "success"
      ? Brand.good
      : phase === "rejected"
        ? Brand.bad
        : feedbackTone === "bad"
          ? Brand.warn
          : reached
            ? Brand.good
            : feedbackTone === "good"
              ? Brand.good
              : Brand.textSecondary;

  const stopCamera = useCallback(() => {
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  const finish = useCallback(
    (didReach: boolean) => {
      if (finishedRef.current) return;
      finishedRef.current = true;
      stopCamera();
      if (isQualityExercise(exercise)) {
        setMostCommonIssue(issueTrackerRef.current?.mostCommonIssue() ?? null);
      }
      if (didReach) {
        const res = completeQuest(quest.points);
        setResult(res);
        setPhase("success");
        haptic("success");
      } else {
        setPhase("rejected");
        haptic("error");
      }
    },
    [completeQuest, quest.points, stopCamera, exercise],
  );

  const drawSkeleton = useCallback((lm: Landmark[] | null) => {
    const canvas = canvasRef.current;
    const video = videoRef.current;
    if (!canvas || !video) return;
    if (
      canvas.width !== video.videoWidth ||
      canvas.height !== video.videoHeight
    ) {
      canvas.width = video.videoWidth || 640;
      canvas.height = video.videoHeight || 480;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!lm) return;

    const w = canvas.width;
    const h = canvas.height;
    ctx.lineWidth = 4;
    ctx.strokeStyle = "rgba(224, 99, 69, 0.85)";
    for (const [a, b] of POSE_CONNECTIONS) {
      const pa = lm[a];
      const pb = lm[b];
      if (!pa || !pb) continue;
      ctx.beginPath();
      ctx.moveTo(pa.x * w, pa.y * h);
      ctx.lineTo(pb.x * w, pb.y * h);
      ctx.stroke();
    }
    ctx.fillStyle = "rgba(236, 233, 226, 0.95)";
    for (const p of lm) {
      ctx.beginPath();
      ctx.arc(p.x * w, p.y * h, 4, 0, Math.PI * 2);
      ctx.fill();
    }
  }, []);

  // Main lifecycle: load model, open camera, run detection loop.
  useEffect(() => {
    let cancelled = false;
    finishedRef.current = false;
    counterRef.current = new RepCounter(exercise as RepExerciseId);
    qualityBufferRef.current = new QualityBuffer();
    qualityModelRef.current = null;
    issueTrackerRef.current = new IssueTracker();
    lastVideoTimeRef.current = -1;

    if (isQualityExercise(exercise)) {
      console.log(`[quality:${exercise}] loading model…`);
      getQualityModel(exercise)
        .then((model) => {
          console.log(`[quality:${exercise}] model ready`);
          if (!cancelled) qualityModelRef.current = model;
        })
        .catch((err) => {
          // Quality model is a nice-to-have layered on the geometric rep
          // counter above — if it fails to load, reps still count fine.
          console.error(`[quality:${exercise}] model load failed`, err);
        });
    }

    async function runQualityInference(
      model: CompiledModel,
      ex: QualityExerciseId,
      window: Float32Array[],
    ) {
      console.log(`[quality:${ex}] window ready (${window.length} frames), running inference…`);
      const input = new Tensor(flattenWindow(window), [1, SEQ_LEN, FEATURE_LEN]);
      try {
        const results = await model.run(input);
        const output = results[0];
        const data = await output.data();
        if (!cancelled) {
          const quality = decodeQuality(ex, data);
          issueTrackerRef.current?.record(quality.label, GOOD_LABEL[ex]);
          console.log(
            `[quality:${ex}]`,
            quality.label,
            `${(quality.confidence * 100).toFixed(1)}%`,
            "—",
            quality.probs
              .map((p) => `${p.label}=${(p.prob * 100).toFixed(1)}%`)
              .join(" "),
          );
          setLivePrediction(quality);
          setFeedback(
            quality.message ||
              config.messages[quality.good ? "correct" : "incorrect"],
          );
          setFeedbackTone(quality.good ? "good" : "bad");
        }
        results.forEach((t) => t.delete());
      } catch (err) {
        // best-effort — fall back to whatever feedback is already showing.
        console.error(`[quality:${ex}] inference failed`, err);
      } finally {
        input.delete();
      }
    }

    async function start() {
      try {
        const { FilesetResolver, PoseLandmarker } =
          await loadVision(VISION_CDN);
        const fileset = await FilesetResolver.forVisionTasks(WASM_URL);
        if (cancelled) return;
        const landmarker = await PoseLandmarker.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: MODEL_URL, delegate: "GPU" },
          runningMode: "VIDEO",
          numPoses: 1,
          minPoseDetectionConfidence: 0.5,
          minPosePresenceConfidence: 0.5,
          minTrackingConfidence: 0.5,
        });
        if (cancelled) {
          landmarker.close();
          return;
        }
        landmarkerRef.current = landmarker;
      } catch {
        if (!cancelled) {
          setSetup("error");
          setSetupMessage(
            "Could not load the pose model. Check your connection and try again.",
          );
        }
        return;
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: "user",
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        const video = videoRef.current;
        if (video) {
          video.srcObject = stream;
          await video.play().catch(() => undefined);
        }
        setSetup("ready");
        rafRef.current = requestAnimationFrame(loop);
      } catch {
        if (!cancelled) {
          setSetup("denied");
        }
      }
    }

    function loop() {
      const video = videoRef.current;
      const landmarker = landmarkerRef.current;
      if (!video || !landmarker || cancelled) return;

      if (
        video.readyState >= 2 &&
        video.currentTime !== lastVideoTimeRef.current
      ) {
        lastVideoTimeRef.current = video.currentTime;
        const now = performance.now();
        let landmarks: Landmark[] | null = null;
        try {
          const res = landmarker.detectForVideo(video, now);
          landmarks = (res.landmarks?.[0] as Landmark[] | undefined) ?? null;
        } catch {
          landmarks = null;
        }

        if (landmarks && poseVisible(landmarks)) {
          drawSkeleton(landmarks);
          analyze(landmarks);
        } else {
          drawSkeleton(null);
          if (!finishedRef.current) {
            setFeedback("Step back so your whole body is in frame");
            setFeedbackTone("idle");
          }
        }
      }

      rafRef.current = requestAnimationFrame(loop);
    }

    function analyze(lm: Landmark[]) {
      if (finishedRef.current) return;

      const counter = counterRef.current;
      if (!counter) return;
      const update = counter.update(lm);
      if (update.repCompleted) {
        setCount(update.reps);
        // For pushup/lunge the trained quality model (below) owns the
        // feedback text — it updates independently every SEQ_LEN frames,
        // same as final.py's last_feedback. Squat has no model, so it keeps
        // the geometric form message final.py also falls back to.
        if (!isQualityExercise(exercise)) {
          if (update.formBad) {
            setFeedback(update.message ?? config.messages.incorrect);
            setFeedbackTone("bad");
          } else {
            setFeedback(config.messages.correct);
            setFeedbackTone("good");
          }
        }
        haptic(
          update.formBad
            ? "warn"
            : update.reps >= quest.target
              ? "success"
              : "rep",
        );
        if (update.reps >= quest.target) finish(true);
      }

      if (isQualityExercise(exercise)) {
        const window = qualityBufferRef.current?.push(extractFeatures(lm)) ?? null;
        const model = qualityModelRef.current;
        if (window && model) void runQualityInference(model, exercise, window);
      }
    }

    start();

    return () => {
      cancelled = true;
      stopCamera();
      landmarkerRef.current?.close();
      landmarkerRef.current = null;
    };
    // restartKey forces a fresh session on "Try again".
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exercise, quest.target, restartKey]);

  const onDone = useCallback(() => {
    if (phase !== "active") return;
    finish(count >= quest.target);
  }, [phase, count, quest.target, finish]);

  const onTryAgain = useCallback(() => {
    setCount(0);
    setFeedback(config.messages.idle);
    setFeedbackTone("idle");
    setResult(null);
    setMostCommonIssue(null);
    setLivePrediction(null);
    setPhase("active");
    setSetup("loading");
    setRestartKey((k) => k + 1);
  }, [config.messages]);

  const progress = Math.min(count / quest.target, 1);

  const headlineLabel =
    phase === "success"
      ? "SUCCESS"
      : phase === "rejected"
        ? "REJECTED"
        : feedbackTone === "bad"
          ? "FORM"
          : reached
            ? "DONE"
            : feedbackTone === "good"
              ? "GOOD"
              : "READY";

  const headline =
    phase === "success"
      ? "Quest complete"
      : phase === "rejected"
        ? "Not enough reps"
        : reached
          ? "Target hit"
          : feedback;

  const showIssueCard = phase !== "active" && isQualityExercise(exercise);

  return (
    <View style={styles.root}>
      <View style={styles.cameraLayer} pointerEvents="none">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          style={{
            position: "absolute",
            width: "100%",
            height: "100%",
            objectFit: "cover",
            transform: "scaleX(-1)",
            background: "#1a1917",
          }}
        />
        <canvas
          ref={canvasRef}
          style={{
            position: "absolute",
            width: "100%",
            height: "100%",
            objectFit: "cover",
            transform: "scaleX(-1)",
          }}
        />
      </View>

      <View style={[styles.scrim, styles.scrimTop]} pointerEvents="none" />
      <View style={[styles.scrim, styles.scrimBottom]} pointerEvents="none" />

      <SafeAreaView style={styles.overlay} edges={["top", "bottom"]}>
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

        {setup !== "ready" && phase === "active" ? (
          <View style={styles.setupCard}>
            <Text style={styles.setupTitle}>
              {setup === "loading"
                ? "Starting camera…"
                : setup === "denied"
                  ? "Camera access needed"
                  : "Something went wrong"}
            </Text>
            <Text style={styles.setupText}>
              {setup === "loading"
                ? "Loading the pose model and your front camera."
                : setup === "denied"
                  ? "Allow camera access in your browser, then tap retry."
                  : setupMessage}
            </Text>
            {setup !== "loading" ? (
              <Pressable style={styles.retryBtn} onPress={onTryAgain}>
                <Text style={styles.retryBtnText}>Retry</Text>
              </Pressable>
            ) : null}
          </View>
        ) : (
          <View style={styles.feedbackWrap}>
            <View
              style={[
                styles.feedbackCard,
                { borderColor: accent, shadowColor: accent },
              ]}
            >
              <Text style={[styles.feedbackLabel, { color: accent }]}>
                {headlineLabel}
              </Text>
              <Text style={styles.feedbackMessage}>{headline}</Text>
              {phase === "success" && result ? (
                <Text style={styles.feedbackPoints}>
                  +{result.pointsAdded} pts
                  {result.streakExtended ? " · streak extended" : ""}
                </Text>
              ) : null}
              {phase === "rejected" ? (
                <Text style={styles.rejectText}>
                  We counted {count} of {quest.target} reps. Finish the set to
                  bank it.
                </Text>
              ) : null}
            </View>
          </View>
        )}

        {showIssueCard ? (
          <View
            style={[
              styles.issueCard,
              mostCommonIssue ? styles.issueCardWarn : styles.issueCardGood,
            ]}
          >
            <Text
              style={[
                styles.issueKicker,
                { color: mostCommonIssue ? Brand.warn : Brand.good },
              ]}
            >
              {mostCommonIssue ? "Most common issue" : "Form check"}
            </Text>
            <Text style={styles.issueValue}>
              {mostCommonIssue
                ? CLASS_LABEL[mostCommonIssue] ?? mostCommonIssue
                : "Clean form the whole set!"}
            </Text>
          </View>
        ) : null}

        {phase === "active" && isQualityExercise(exercise) && livePrediction ? (
          <View style={styles.liveCard}>
            <Text style={styles.liveKicker}>Model output (live)</Text>
            {livePrediction.probs.map((p) => {
              const isTop = p.label === livePrediction.label;
              return (
                <View key={p.label} style={styles.liveRow}>
                  <Text
                    style={[styles.liveRowLabel, isTop && styles.liveRowLabelActive]}
                    numberOfLines={1}
                  >
                    {CLASS_LABEL[p.label] ?? p.label}
                  </Text>
                  <View style={styles.liveBarTrack}>
                    <View
                      style={[
                        styles.liveBarFill,
                        {
                          width: `${Math.round(p.prob * 100)}%`,
                          backgroundColor: isTop
                            ? livePrediction.good
                              ? Brand.good
                              : Brand.warn
                            : Brand.borderStrong,
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
            <View
              style={[
                styles.progressFill,
                { width: `${progress * 100}%`, backgroundColor: accent },
              ]}
            />
          </View>

          {phase === "active" && (
            <>
              <Pressable
                style={[styles.doneBtn, reached && styles.doneBtnReady]}
                onPress={onDone}
              >
                <Text
                  style={[
                    styles.doneBtnText,
                    reached && styles.doneBtnTextReady,
                  ]}
                >
                  {reached ? `Finish · +${quest.points} pts` : "I'm done"}
                </Text>
              </Pressable>
              <Text style={styles.doneHint}>
                {reached
                  ? "Nice work — banking your points."
                  : `${quest.target - count} more reps to earn the points.`}
              </Text>
            </>
          )}

          {phase === "success" && (
            <>
              {result && !result.streakReady ? (
                <Text style={styles.streakNote}>
                  {STREAK_THRESHOLD - result.pointsToday} more pts today to keep
                  your streak
                </Text>
              ) : null}
              <View style={styles.actionRow}>
                <Pressable
                  style={styles.primaryBtn}
                  onPress={() => router.replace("/")}
                >
                  <Text style={styles.primaryBtnText}>Back to home</Text>
                </Pressable>
                <Pressable
                  style={styles.ghostBtn}
                  onPress={() => router.replace("/leaderboard")}
                >
                  <Text style={styles.ghostBtnText}>Leaderboard</Text>
                </Pressable>
              </View>
            </>
          )}

          {phase === "rejected" && (
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
  cameraLayer: { ...StyleSheet.absoluteFill, overflow: "hidden" },
  scrim: {
    position: "absolute",
    left: 0,
    right: 0,
    height: 180,
    backgroundColor: Overlay.scrim,
  },
  scrimTop: { top: 0 },
  scrimBottom: { bottom: 0, height: 280 },
  overlay: {
    flex: 1,
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingBottom: 12,
    paddingTop: Platform.select({ web: 84, default: 12 }),
  },

  topRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 10,
  },
  statusChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: Brand.radiusPill,
    backgroundColor: Overlay.card,
    borderWidth: 1,
    borderColor: Overlay.hairline,
  },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  statusChipText: { color: Brand.text, fontSize: 13, fontWeight: "600" },
  closeBtn: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: Brand.radiusPill,
    backgroundColor: Overlay.card,
    borderWidth: 1,
    borderColor: Overlay.hairline,
  },
  closeBtnText: { color: Brand.textSecondary, fontSize: 13, fontWeight: "600" },

  setupCard: {
    alignSelf: "center",
    alignItems: "center",
    gap: 8,
    maxWidth: 320,
    paddingHorizontal: 22,
    paddingVertical: 18,
    borderRadius: Brand.radiusLg,
    backgroundColor: Overlay.cardStrong,
    borderWidth: 1,
    borderColor: Overlay.hairline,
  },
  setupTitle: { color: Brand.text, fontSize: 16, fontWeight: "700" },
  setupText: {
    color: Brand.textSecondary,
    fontSize: 13,
    textAlign: "center",
    lineHeight: 19,
  },
  retryBtn: {
    marginTop: 4,
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: Brand.radiusPill,
    backgroundColor: Brand.accent,
  },
  retryBtnText: { color: "#fff", fontSize: 13, fontWeight: "700" },

  feedbackWrap: { alignItems: "center", justifyContent: "center" },
  feedbackCard: {
    alignItems: "center",
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
  feedbackLabel: {
    fontFamily: Fonts.mono,
    fontSize: 12,
    letterSpacing: 2,
    fontWeight: "700",
  },
  feedbackMessage: {
    color: Brand.text,
    fontSize: 18,
    lineHeight: 24,
    fontWeight: "600",
    textAlign: "center",
  },
  feedbackPoints: {
    fontFamily: Fonts.mono,
    color: Brand.accent,
    fontSize: 15,
    fontWeight: "700",
    marginTop: 2,
  },
  issueCard: {
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderRadius: Brand.radiusLg,
    borderWidth: 1.5,
  },
  issueCardWarn: {
    backgroundColor: "rgba(224, 99, 69, 0.14)",
    borderColor: Brand.warn,
  },
  issueCardGood: {
    backgroundColor: "rgba(90, 154, 130, 0.14)",
    borderColor: Brand.good,
  },
  issueKicker: {
    fontFamily: Fonts.mono,
    fontSize: 11,
    letterSpacing: 1.5,
    textTransform: "uppercase",
    fontWeight: "800",
  },
  issueValue: {
    color: Brand.text,
    fontSize: 17,
    fontWeight: "800",
    textAlign: "center",
  },

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
    textTransform: "uppercase",
    color: Brand.textTertiary,
    fontWeight: "700",
  },
  liveRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  liveRowLabel: {
    width: 116,
    color: Brand.textSecondary,
    fontSize: 12,
    fontWeight: "600",
  },
  liveRowLabelActive: { color: Brand.text, fontWeight: "800" },
  liveBarTrack: {
    flex: 1,
    height: 8,
    borderRadius: 4,
    backgroundColor: "rgba(236, 233, 226, 0.1)",
    overflow: "hidden",
  },
  liveBarFill: { height: "100%", borderRadius: 4 },
  livePct: {
    width: 38,
    textAlign: "right",
    fontFamily: Fonts.mono,
    color: Brand.textSecondary,
    fontSize: 12,
  },
  rejectText: {
    color: Brand.textSecondary,
    fontSize: 13,
    textAlign: "center",
    marginTop: 2,
  },

  bottomCard: {
    gap: 14,
    paddingHorizontal: 22,
    paddingVertical: 20,
    borderRadius: Brand.radiusLg,
    backgroundColor: Overlay.card,
    borderWidth: 1,
    borderColor: Overlay.hairline,
  },
  repRow: { flexDirection: "row", alignItems: "flex-end", gap: 10 },
  repCount: {
    fontFamily: Fonts.mono,
    color: Brand.text,
    fontSize: 52,
    lineHeight: 54,
    fontWeight: "700",
  },
  repTarget: {
    color: Brand.textSecondary,
    fontSize: 16,
    fontWeight: "600",
    paddingBottom: 6,
  },
  progressTrack: {
    height: 6,
    borderRadius: 3,
    backgroundColor: "rgba(236, 233, 226, 0.14)",
    overflow: "hidden",
  },
  progressFill: { height: "100%", borderRadius: 3 },
  streakNote: { color: Brand.textSecondary, fontSize: 12, textAlign: "center" },

  actionRow: { flexDirection: "row", gap: 10 },
  doneBtn: {
    paddingVertical: 15,
    borderRadius: Brand.radius,
    borderWidth: 1,
    borderColor: Brand.borderStrong,
    alignItems: "center",
  },
  doneBtnReady: { backgroundColor: Brand.accent, borderColor: Brand.accent },
  doneBtnText: { color: Brand.text, fontSize: 15, fontWeight: "800" },
  doneBtnTextReady: { color: "#fff" },
  doneHint: {
    color: Brand.textSecondary,
    fontSize: 12,
    textAlign: "center",
    marginTop: -4,
  },
  primaryBtn: {
    flex: 1,
    paddingVertical: 13,
    borderRadius: Brand.radius,
    backgroundColor: Brand.accent,
    alignItems: "center",
  },
  primaryBtnText: { color: "#fff", fontSize: 14, fontWeight: "700" },
  ghostBtn: {
    flex: 1,
    paddingVertical: 13,
    borderRadius: Brand.radius,
    borderWidth: 1,
    borderColor: Brand.borderStrong,
    alignItems: "center",
  },
  ghostBtnText: { color: Brand.text, fontSize: 14, fontWeight: "700" },
});
