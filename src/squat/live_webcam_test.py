import tensorflow as tf
import cv2 as cv
from src.universal_trainer import Exercise
from src.squat.model import Squat
import numpy as np
import mediapipe as mp

pushup = Exercise("squat", Squat, False)
seq_len = 106
model = tf.keras.models.load_model("models/squat.keras", custom_objects={"Squat": Squat})

# label map
label_map = {
    "good_squat": 0,
    "partial_squat": 1,
}

idx_to_label = {v: k for k, v in label_map.items()}

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

pred_buffer = []
current_prediction = "waiting..."

cap = cv.VideoCapture(0)

frame_idx = 0
n_reps = 0

with PoseLandmarker.create_from_options(options) as landmarker:
    while True:
        ret, frame = cap.read()
        if not ret: break
        frame = cv.flip(frame, 1)
        pred_frame = cv.resize(frame, (640, 480))

        rgb_frame = cv.cvtColor(pred_frame, cv.COLOR_BGR2RGB) # convert to rgb
        mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb_frame) # convert to mediapipe image
        timestamp_ms = int((frame_idx / 30) * 1000) # get timestamp
        result = landmarker.detect_for_video(mp_image, timestamp_ms) # inference
        pose_arr = pushup.landmarks_to_numpy(result) # convert to array
        derived_features = pushup.extract_features(pose_arr)
        pred_buffer.append(derived_features)
        frame_idx += 1

        # run inference once buffer is full
        if len(pred_buffer) == seq_len:
            input_tensor = tf.stack(pred_buffer, axis=0)        
            input_tensor = tf.expand_dims(input_tensor, axis=0) 
            prediction = model(input_tensor, training=False)
            print(prediction)
            
            prob = prediction.numpy()[0][0]  # scalar between 0 and 1
            current_prediction = "partial_squat" if prob >= 0.5 else "good_squat"
            
            n_reps += 1 if current_prediction == "good_squat" else 0
            print(f"prediction: {current_prediction} (prob={prob:.3f})")
            pred_buffer = []

        display_text = f"Prediction: {current_prediction}"

        cv.rectangle(
            frame,
            (10, 10),
            (500, 90),
            (0, 0, 0),
            -1
        )

        cv.putText(
            frame,
            display_text,
            (20, 45),
            cv.FONT_HERSHEY_SIMPLEX,
            0.8,
            (0, 255, 0),
            2,
            cv.LINE_AA
        )

        cv.imshow("frame", frame)
        if cv.waitKey(1) & 0xFF == ord('q'):
            break

print(n_reps)
cap.release()