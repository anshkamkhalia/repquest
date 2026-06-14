import cv2 as cv
import numpy as np
import mediapipe as mp
class RepCounter:

    def __init__(self, exercise: str):
        self.exercise = exercise
        BaseOptions = mp.tasks.BaseOptions
        self.PoseLandmarker = mp.tasks.vision.PoseLandmarker
        PoseLandmarkerOptions = mp.tasks.vision.PoseLandmarkerOptions
        VisionRunningMode = mp.tasks.vision.RunningMode

        self.options = PoseLandmarkerOptions(
            base_options=BaseOptions(model_asset_path='/Users/ansh/Downloads/development/repquest/pose_landmarker_full.task'), # this has been modified
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

        if self.exercise not in self.rep_map.keys():
            raise ValueError("enter valid exercise")
        
        self.MIN_ANGLE, self.UPRIGHT_POS_ANGLE = self.rep_map[self.exercise]
        self.WAIT_FRAMES = 20

    def convert_landmarks(self, pose):
        data = []
        for landmark_list in pose.pose_landmarks:
            landmarks_array = np.array([
                [lm.x, lm.y, lm.z] for lm in landmark_list
            ])
            data.append(landmarks_array)
        return np.array(data)

    def calculate_angle(self, a, b, c):  # was missing `self`
        ba = a - b
        bc = c - b
        cos_a = np.dot(ba, bc) / (np.linalg.norm(ba) * np.linalg.norm(bc) + 1e-6)
        return np.degrees(np.arccos(np.clip(cos_a, -1, 1)))  # was np.clip(-1, 1)

    def count_reps(self, path, show_img: bool, return_pose=False):
        cap = cv.VideoCapture(path) # can be 0 or an actual path
        
        # cycle steps
        self.initial = False
        self.low = False
        self.back_up = False
        self.wait_frames_remaining = 0
        self.wait_over = True
        self.n_reps = 0
        frame_idx = 0

        pose = []

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
                    if show_img:
                        cv.imshow("frame", frame)
                        continue
                    continue
                landmark_arr = self.convert_landmarks(pose=result)
                
                if return_pose:
                    pose.append(landmark_arr)
                
                kypts = self.rep_map_kypts[self.exercise]
                right_pt1 = landmark_arr[0, kypts[0][0]]
                right_pt2 = landmark_arr[0, kypts[0][1]]
                right_pt3 = landmark_arr[0, kypts[0][2]]
                left_pt1  = landmark_arr[0, kypts[1][0]]
                left_pt2  = landmark_arr[0, kypts[1][1]]
                left_pt3  = landmark_arr[0, kypts[1][2]]
                
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
                
                else:
                    self.wait_frames_remaining -= 1
                    if self.wait_frames_remaining == 0:
                        self.wait_over = True
                frame_idx += 1


                if show_img:
                    cv.imshow("frame", frame)
                if cv.waitKey(1) & 0xFF == ord('q'):
                    break
        
        if not return_pose:
            return self.n_reps
        else:
            return self.n_reps, pose