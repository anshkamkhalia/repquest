import type { PoseLandmarker } from "@mediapipe/tasks-vision";
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
    POSE_CONNECTIONS,
    RepCounter,
    checkPlank,
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
  const isHold = quest.kind === "hold";

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
  const [restartKey, setRestartKey] = useState(0);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const landmarkerRef = useRef<PoseLandmarker | null>(null);
  const counterRef = useRef<RepCounter | null>(null);
  const rafRef = useRef<number | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const lastVideoTimeRef = useRef(-1);
  const finishedRef = useRef(false);

  // plank timing
  const heldMsRef = useRef(0);
  const brokenMsRef = useRef(0);
  const lastTsRef = useRef(0);

  const reached = count >= quest.target;
  const unitLabel = isHold ? "sec" : "reps";
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
    [completeQuest, quest.points, stopCamera],
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
    counterRef.current = isHold
      ? null
      : new RepCounter(exercise as RepExerciseId);
    heldMsRef.current = 0;
    brokenMsRef.current = 0;
    lastTsRef.current = 0;
    lastVideoTimeRef.current = -1;

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
          analyze(landmarks, now);
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

    function analyze(lm: Landmark[], now: number) {
      if (finishedRef.current) return;

      if (isHold) {
        const dt = lastTsRef.current ? now - lastTsRef.current : 0;
        lastTsRef.current = now;
        const { holding, message } = checkPlank(lm);
        if (holding) {
          brokenMsRef.current = 0;
          heldMsRef.current += dt;
          const secs = Math.floor(heldMsRef.current / 1000);
          setCount(secs);
          setFeedback(config.messages.correct);
          setFeedbackTone("good");
          if (secs >= quest.target) finish(true);
        } else {
          brokenMsRef.current += dt;
          setFeedback(message ?? config.messages.incorrect);
          setFeedbackTone("bad");
          if (brokenMsRef.current > 800) {
            heldMsRef.current = 0;
            setCount(0);
          }
        }
        return;
      }

      const counter = counterRef.current;
      if (!counter) return;
      const update = counter.update(lm);
      if (update.repCompleted) {
        setCount(update.reps);
        if (update.formBad) {
          setFeedback(update.message ?? config.messages.incorrect);
          setFeedbackTone("bad");
          haptic("warn");
        } else {
          setFeedback(config.messages.correct);
          setFeedbackTone("good");
          haptic(update.reps >= quest.target ? "success" : "rep");
        }
        if (update.reps >= quest.target) finish(true);
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
  }, [exercise, isHold, quest.target, restartKey]);

  const onDone = useCallback(() => {
    if (phase !== "active") return;
    finish(count >= quest.target);
  }, [phase, count, quest.target, finish]);

  const onTryAgain = useCallback(() => {
    setCount(0);
    setFeedback(config.messages.idle);
    setFeedbackTone("idle");
    setResult(null);
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
        ? `Not enough ${unitLabel}`
        : reached
          ? isHold
            ? "Hold complete"
            : "Target hit"
          : feedback;

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
          <View />
        )}

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
                We counted {count} of {quest.target} {unitLabel}. Finish the set
                to bank it.
              </Text>
            ) : null}
          </View>
        </View>

        <View style={styles.bottomCard}>
          <View style={styles.repRow}>
            <Text style={styles.repCount}>{count}</Text>
            <Text style={styles.repTarget}>
              / {quest.target} {unitLabel}
            </Text>
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
                  : isHold
                    ? `Hold the position for ${quest.target} seconds.`
                    : `${quest.target - count} more ${unitLabel} to earn the points.`}
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
