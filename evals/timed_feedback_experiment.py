# uses rep counter on video
# when rep detected
# use last 106 frames for prediction
# reps are detected at the end of the cycle, so this should work

import tensorflow as tf
import cv2 as cv
import numpy as np
from src.universal_trainer import Exercise
import mediapipe as mp

from src.pushup.model import Pushup
from src.squat.model import Squat
from src.lunge.model import Lunge

class TimeFeedback:

    def __init__(self):
        BaseOptions = mp.tasks.BaseOptions
        self.PoseLandmarker = mp.tasks.vision.PoseLandmarker
        PoseLandmarkerOptions = mp.tasks.vision.PoseLandmarkerOptions
        VisionRunningMode = mp.tasks.vision.RunningMode

        self.options = PoseLandmarkerOptions(
            base_options=BaseOptions(model_asset_path='pose_landmarker_full.task'),
            running_mode=VisionRunningMode.VIDEO,
            num_poses=1,
            min_pose_detection_confidence=0.5,
            min_pose_presence_confidence=0.5,
            min_tracking_confidence=0.5,
            output_segmentation_masks=False,
        )

        self.rep_map = {
            "pushup": (60, 135),
            "squat": (87.5, 160),
            "lunge": (90, 140),
        }

        self.rep_map_kypts = {
            "pushup": [[15, 13, 11], [16, 14, 12]], # right points, left points
            "squat": [[23, 25, 27], [24, 26, 28]],
            "lunge": [[23, 25, 27], [24, 26, 28]],
        }

        self.WAIT_FRAMES = 20
        self.SEQ_LEN = 106

        # text shown on-screen, updated every time a rep completes
        self.last_feedback = "Waiting for first rep..."

    def convert_landmarks(self, pose):
        data = []
        for landmark_list in pose.pose_landmarks:
            landmarks_array = np.array([
                [lm.x, lm.y, lm.z] for lm in landmark_list
            ])
            data.append(landmarks_array)
        return np.array(data)

    def calculate_angle(self, a, b, c):
        ba = a - b
        bc = c - b
        cos_a = np.dot(ba, bc) / (np.linalg.norm(ba) * np.linalg.norm(bc) + 1e-6)
        return np.degrees(np.arccos(np.clip(cos_a, -1, 1)))

    def run_feedback_model(self, exercise, buffer):

        if exercise == "pushup":
            self.model = tf.keras.models.load_model(
                "models/pushup.keras",
                custom_objects={"Pushup": Pushup}
            )
            self.label_map = {
                "good_pushup": 0,
                "high_hip_pushup": 1,
                "low_hip_pushup": 2,
            }

        elif exercise == "squat":
            self.model = tf.keras.models.load_model(
                "models/squat.keras",
                custom_objects={"Squat": Squat}
            )
            self.label_map = {
                "good_squat": 0,
                "partial_squat": 1,
            }

        else:
            self.model = tf.keras.models.load_model(
                "models/lunge.keras",
                custom_objects={"Lunge": Lunge}
            )
            self.label_map = {
                "angled_back_lunge": 0,
                "good_lunge": 1,
                "partial_lunge": 2,
            }

        buffer = buffer[-self.SEQ_LEN:] # get last 106 elements

        # convert to tensor
        input_tensor = tf.stack(buffer, axis=0)
        input_tensor = tf.expand_dims(input_tensor, axis=0)
        prediction = self.model(input_tensor, training=False)
        pred_class = tf.argmax(prediction, axis=-1).numpy()[0]
        current_prediction = list(self.label_map.keys())[pred_class]
        buffer = []

        return current_prediction, buffer

    def draw_overlay(self, frame):
        h, w = frame.shape[:2]

        overlay = frame.copy()
        cv.rectangle(overlay, (0, 0), (w, 70), (0, 0, 0), -1)
        cv.addWeighted(overlay, 0.4, frame, 0.6, 0, frame)

        cv.putText(
            frame, f"Reps: {self.n_reps}",
            (15, 30), cv.FONT_HERSHEY_SIMPLEX, 0.9, (255, 255, 255), 2, cv.LINE_AA
        )
        cv.putText(
            frame, f"Feedback: {self.last_feedback}",
            (15, 60), cv.FONT_HERSHEY_SIMPLEX, 0.7, (0, 255, 255), 2, cv.LINE_AA
        )
        return frame

    def run_on_video(self, path, exercise: str, show_frame: bool) -> str:

        cap = cv.VideoCapture(path) # can be an actual path or just 0

        self.exercise = exercise
        self.MIN_ANGLE, self.UPRIGHT_POS_ANGLE = self.rep_map[self.exercise]

        # cycle steps
        self.initial = False
        self.low = False
        self.back_up = False
        self.wait_frames_remaining = 0
        self.wait_over = True
        self.n_reps = 0
        frame_idx = 0

        buffer = []

        self.exercise_utils = Exercise(exercise, model=None, on_colab=False)

        with self.PoseLandmarker.create_from_options(self.options) as self.landmarker:
            while True:
                ret, frame = cap.read()
                if not ret: break
                frame = cv.flip(frame, 1)
                rgb_frame = cv.cvtColor(frame, cv.COLOR_BGR2RGB) # convert to rgb
                mp_img = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb_frame) # convert to mp image
                timestamp_ms = int((frame_idx/30) * 1000) # get timestamp
                result = self.landmarker.detect_for_video(mp_img, timestamp_ms) # inference

                if not result.pose_landmarks:
                    frame_idx += 1
                    if show_frame:
                        self.draw_overlay(frame)
                        cv.imshow("frame", frame)
                        if cv.waitKey(1) & 0xFF == ord('q'):
                            break
                    continue

                landmark_arr = self.convert_landmarks(pose=result)
                buffer.append(self.exercise_utils.extract_features(landmark_arr))

                kypts = self.rep_map_kypts[self.exercise]
                right_pt1 = landmark_arr[0, kypts[0][0]]
                right_pt2 = landmark_arr[0, kypts[0][1]]
                right_pt3 = landmark_arr[0, kypts[0][2]]
                left_pt1 = landmark_arr[0, kypts[1][0]]
                left_pt2 = landmark_arr[0, kypts[1][1]]
                left_pt3 = landmark_arr[0, kypts[1][2]]

                right_angle = self.calculate_angle(right_pt1, right_pt2, right_pt3)
                left_angle = self.calculate_angle(left_pt1, left_pt2, left_pt3)

                if self.wait_over:
                    if not self.initial and not self.low and not self.back_up:
                        if right_angle > self.UPRIGHT_POS_ANGLE or left_angle > self.UPRIGHT_POS_ANGLE:
                            self.initial = True
                    elif self.initial and not self.low:
                        if right_angle < self.MIN_ANGLE or left_angle < self.MIN_ANGLE:
                            self.low = True
                    elif self.initial and self.low and not self.back_up:
                        if right_angle > self.UPRIGHT_POS_ANGLE or left_angle > self.UPRIGHT_POS_ANGLE:
                            self.back_up = True
                    if self.initial and self.low and self.back_up:
                        self.initial, self.low, self.back_up = False, False, False
                        self.wait_over = False
                        self.wait_frames_remaining = self.WAIT_FRAMES
                        self.n_reps += 1

                        # rep is detected -> run feedback model
                        prediction, buffer = self.run_feedback_model( # get prediction
                            exercise=exercise,
                            buffer=buffer,
                        )
                        self.last_feedback = prediction # store for on-screen display

                else:
                    self.wait_frames_remaining -= 1
                    if self.wait_frames_remaining == 0:
                        self.wait_over = True

                if show_frame:
                    self.draw_overlay(frame)
                    cv.imshow("frame", frame)
                    if cv.waitKey(1) & 0xFF == ord('q'):
                        break

                frame_idx += 1

        cap.release()
        if show_frame:
            cv.destroyAllWindows()

        return f"completed {self.n_reps} reps. Last feedback: {self.last_feedback}"
    
import sys
feedback = TimeFeedback()
end = feedback.run_on_video(path=0, exercise=sys.argv[1], show_frame=True)
print(end)