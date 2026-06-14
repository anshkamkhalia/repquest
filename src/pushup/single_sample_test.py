import tensorflow as tf
import cv2 as cv
from src.universal_trainer import Exercise
from src.pushup.model import Pushup
import numpy as np
import mediapipe as mp

pushup = Exercise("pushup", Pushup, False)
seq_len = 106
model = tf.keras.models.load_model("models/pushup.keras", custom_objects={"Pushup": Pushup})

# label map
label_map = {
    "good_pushup": 0,
    "high_hip_pushup": 1,
    "low_hip_pushup": 2,
    "partial_pushup": 3,
}

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

# pick random class
cls = np.random.choice(list(label_map.keys()))
random_vid = np.random.randint(0,19)

pred_buffer = []

cap = cv.VideoCapture(f"video_data/pushup/{cls}/{cls}_{random_vid}.mp4")

frame_idx = 0

with PoseLandmarker.create_from_options(options) as landmarker:
    while True:
        ret, frame = cap.read()
        if not ret: break
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
            pred_class = tf.argmax(prediction, axis=-1).numpy()[0]
            pred_label = list(label_map.keys())[pred_class]
            print(f"prediction: {pred_label} | actual: {cls}")
            pred_buffer = []  # reset buffer for next sequence

        # cv.imshow("frame", frame)
        # if cv.waitKey(1) & 0xFF == ord('q'):
        #     break

cap.release()