import cv2 as cv
import numpy as np
import mediapipe as mp

BaseOptions = mp.tasks.BaseOptions
PoseLandmarker = mp.tasks.vision.PoseLandmarker
PoseLandmarkerOptions = mp.tasks.vision.PoseLandmarkerOptions
VisionRunningMode = mp.tasks.vision.RunningMode

options = PoseLandmarkerOptions(
   base_options=BaseOptions(model_asset_path='pose_landmarker_full.task'),
   running_mode=VisionRunningMode.VIDEO,
   num_poses=1,
   min_pose_detection_confidence=0.5,
   min_pose_presence_confidence=0.5,
   min_tracking_confidence=0.5,
   output_segmentation_masks=False,
)

def convert_landmarks(pose):
   data = []

   for landmark_list in pose.pose_landmarks:
       landmarks_array = np.array([
           [lm.x, lm.y, lm.z] for lm in landmark_list
       ])
       data.append(landmarks_array)
      
   return np.array(data)

cap = cv.VideoCapture(0)
# cap = cv.VideoCapture("video_data/squat/good_squat/good_squat_0.mp4")

frame_idx = 0
n_reps = 0

MIN_ANGLE = 87.5
UPRIGHT_POS_ANGLE = 160

def calculate_angle(a,b,c):

    # use vector dot product formula
    ba = a-b
    bc = c-b
    cos_a = np.dot(ba, bc) / (np.linalg.norm(ba) * np.linalg.norm(bc) + 1e-6)
    return np.degrees(np.arccos(np.clip(cos_a, -1, 1)))

# cycle steps
initial = False
low = False
back_up = False

# wait frames
WAIT_FRAMES = 10
wait_frames_remaining = 0
wait_over = True

with PoseLandmarker.create_from_options(options) as landmarker:
    while True:
        ret, frame = cap.read()
        if not ret: break
        frame = cv.flip(frame, 1)

        rgb_frame = cv.cvtColor(frame, cv.COLOR_BGR2RGB) # convert to rgb
        mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb_frame) # convert to mediapipe image
        timestamp_ms = int((frame_idx / 30) * 1000) # get timestamp
        result = landmarker.detect_for_video(mp_image, timestamp_ms) # inference

        if not result.pose_landmarks:
            frame_idx += 1
            cv.imshow("frame", frame)
            continue

        landmark_array = convert_landmarks(pose=result)[0] # remove batch dimension

        # get right side points (hip, knee, ankle)
        right_hip = landmark_array[23]
        right_knee = landmark_array[25]
        right_ankle = landmark_array[27]

        # get left side points (hip, knee, ankle)
        left_hip = landmark_array[24]
        left_knee = landmark_array[26]
        left_ankle = landmark_array[28]

        right_angle = calculate_angle(right_hip, right_knee, right_ankle)
        left_angle = calculate_angle(left_hip, left_knee, left_ankle)

        if wait_over:
            if not initial and not low and not back_up:
                if right_angle > UPRIGHT_POS_ANGLE or left_angle > UPRIGHT_POS_ANGLE:
                    initial = True

            elif initial and not low:
                if right_angle < MIN_ANGLE or left_angle < MIN_ANGLE:
                    low = True

            elif initial and low and not back_up:
                if right_angle > UPRIGHT_POS_ANGLE or left_angle > UPRIGHT_POS_ANGLE:
                    back_up = True

            if initial and low and back_up:
                initial, low, back_up = False, False, False
                wait_over = False
                wait_frames_remaining = WAIT_FRAMES
                print("rep completed")
                n_reps += 1

        else:

            wait_frames_remaining -= 1
            if wait_frames_remaining == 0:
                wait_over = True

        frame_idx += 1

        cv.imshow("frame", frame)

        if cv.waitKey(1) & 0xFF == ord('q'):
            break

print(f"{n_reps} reps completed")

