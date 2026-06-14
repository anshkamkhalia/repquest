# universal class that handles: data preprocessing and training

import cv2 as cv
import os
import mediapipe as mp
import numpy as np
from tqdm import tqdm
import tensorflow as tf

class Exercise:

    def __init__(self, exercise_name: str, model, on_colab):
        self.exercise_name = exercise_name
        self.on_colab = on_colab

        # task config
        self.BaseOptions = mp.tasks.BaseOptions
        self.PoseLandmarker = mp.tasks.vision.PoseLandmarker
        self.PoseLandmarkerOptions = mp.tasks.vision.PoseLandmarkerOptions
        self.VisionRunningMode = mp.tasks.vision.RunningMode

        self.options = self.PoseLandmarkerOptions(
            base_options=self.BaseOptions(model_asset_path='repquest/pose_landmarker_full.task' if self.on_colab else 'pose_landmarker_full.task'),
            running_mode=self.VisionRunningMode.VIDEO,
            num_poses=1,
            min_pose_detection_confidence=0.5,
            min_pose_presence_confidence=0.5,
            min_tracking_confidence=0.5,
            output_segmentation_masks=False,
        )

        self.fps = 30
        self.model = model

    def landmarks_to_numpy(self, result, include_visibility=False):

        poses = []
        for pose_landmarks in result.pose_landmarks:
            if include_visibility:
                arr = np.array([[lm.x, lm.y, lm.z, lm.visibility] for lm in pose_landmarks])
            else:
                arr = np.array([[lm.x, lm.y, lm.z] for lm in pose_landmarks])
            poses.append(arr)
        
        return np.array(poses)

    def angle(self, a, b, c):
        ba = a - b
        bc = c - b
        cos_a = np.dot(ba, bc) / (np.linalg.norm(ba) * np.linalg.norm(bc) + 1e-6)
        return np.degrees(np.arccos(np.clip(cos_a, -1, 1)))

    def midpoint(self, a, b):
        return (a + b) / 2
    
    def augment_pose(self, pose_arr):
        
        if pose_arr.shape[0] == 0:  # no pose detected, return as-is
            return pose_arr

        p = pose_arr[0].copy()

        # gaussian noise
        p += np.random.normal(0, 0.01, p.shape)

        # scale jitter (around the pose center)
        scale = np.random.uniform(0.9, 1.1)
        center = p.mean(axis=0)
        p = (p - center) * scale + center

        # translation jitter
        shift = np.random.uniform(-0.05, 0.05, size=(1, 3))
        shift[0, 2] = 0  # don't shift z
        p += shift

        # torizontal flip (50% chance)
        if np.random.rand() < 0.5:
            p[:, 0] = 1 - p[:, 0]  # flip x coordinates

            # swap left/right landmark pairs
            FLIP_PAIRS = [
                (11, 12), (13, 14), (15, 16),  # shoulders, elbows, wrists
                (17, 18), (19, 20), (21, 22),  # hands
                (23, 24), (25, 26), (27, 28),  # hips, knees, ankles
                (29, 30), (31, 32),            # heels, foot index
            ]
            for l, r in FLIP_PAIRS:
                p[l], p[r] = p[r].copy(), p[l].copy()

        return p[np.newaxis, :]  # restore (1, 33, 3)
    
    def extract_features(self, pose_arr):
    
        empty = np.zeros(11 + 99)

        if pose_arr.shape[0] == 0:  # no pose detected
            return empty

        p = pose_arr[0]  # shape (33, 3)

        l_shoulder = p[11, :2]
        r_shoulder = p[12, :2]
        l_elbow = p[13, :2]
        r_elbow = p[14, :2]
        l_wrist = p[15, :2]
        r_wrist = p[16, :2]
        l_hip = p[23, :2]
        r_hip = p[24, :2]
        l_knee = p[25, :2]
        r_knee = p[26, :2]
        l_ankle = p[27, :2]
        r_ankle = p[28, :2]

        elbow_angle_l = self.angle(l_shoulder, l_elbow, l_wrist)
        elbow_angle_r = self.angle(r_shoulder, r_elbow, r_wrist)
        elbow_angle = (elbow_angle_l + elbow_angle_r) / 2

        mid_shoulder = self.midpoint(l_shoulder, r_shoulder)
        mid_hip = self.midpoint(l_hip, r_hip)
        mid_knee = self.midpoint(l_knee, r_knee)
        mid_ankle = self.midpoint(l_ankle, r_ankle)
        body_line_angle = self.angle(mid_shoulder, mid_hip, mid_knee)

        shoulder_ankle_vec = mid_ankle - mid_shoulder
        shoulder_hip_vec = mid_hip - mid_shoulder
        line_len = np.linalg.norm(shoulder_ankle_vec) + 1e-6
        t = np.dot(shoulder_hip_vec, shoulder_ankle_vec) / (line_len ** 2)
        projected = mid_shoulder + t * shoulder_ankle_vec
        hip_offset = mid_hip[1] - projected[1]

        shoulder_angle_l = self.angle(l_elbow, l_shoulder, l_hip)
        shoulder_angle_r = self.angle(r_elbow, r_shoulder, r_hip)
        shoulder_angle = (shoulder_angle_l + shoulder_angle_r) / 2

        wrist_shoulder_dist = (np.linalg.norm(l_wrist - l_shoulder) + np.linalg.norm(r_wrist - r_shoulder)) / 2
        hip_shoulder_y_offset = mid_hip[1] - mid_shoulder[1]

        knee_angle_l = self.angle(l_hip, l_knee, l_ankle)
        knee_angle_r = self.angle(r_hip, r_knee, r_ankle)
        knee_angle = (knee_angle_l + knee_angle_r) / 2

        features = np.array([
            elbow_angle,
            body_line_angle,
            hip_offset,
            shoulder_angle,
            wrist_shoulder_dist,
            hip_shoulder_y_offset,
            knee_angle,
            elbow_angle_l,
            elbow_angle_r,
            knee_angle_l,
            knee_angle_r,
        ], dtype=np.float32)

        landmarks_flat = p.flatten()

        combined = np.concatenate([features, landmarks_flat])

        return combined
    
    def data_preprocess(self, n_augments):

        data_path = f"repquest/video_data/{self.exercise_name}" if self.on_colab else f"video_data/{self.exercise_name}"
        folders = sorted(os.listdir(data_path))
        folders = [folder for folder in folders if folder != ".DS_Store"]
        self.n_classes = len(folders)
        self.n_augments = n_augments

        X_train = []
        y_train = []
        
        with self.PoseLandmarker.create_from_options(self.options) as landmarker:

            frame_idx = 0
        
            for class_label in tqdm(range(self.n_classes), desc="processing classes"):
            
                curr_folder = folders[class_label]
                
                videos = os.listdir(f"{data_path}/{curr_folder}")
                videos = [video for video in videos if video != ".DS_Store"]

                for video in tqdm(videos, desc=f"  {curr_folder}", leave=False):

                    cap = cv.VideoCapture(f"{data_path}/{curr_folder}/{video}")

                    buffer = []
                    pose_buffer = []
                    
                    while True:
                        ret, frame = cap.read()
                        if not ret: break
                        frame = cv.resize(frame, (640, 480))
                        rgb_frame = cv.cvtColor(frame, cv.COLOR_BGR2RGB)
                        mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb_frame)
                        timestamp_ms = int((frame_idx / self.fps) * 1000)
                        result = landmarker.detect_for_video(mp_image, timestamp_ms)
                        pose_arr = self.landmarks_to_numpy(result)
                        pose_buffer.append(pose_arr)
                        derived_features = self.extract_features(pose_arr)
                        buffer.append(derived_features)
                        frame_idx += 1

                    cap.release()

                    for _ in range(self.n_augments):
                        aug_buffer = []
                        for pose in pose_buffer:
                            pose = self.augment_pose(pose)
                            features = self.extract_features(pose)
                            aug_buffer.append(features)
                        X_train.append(np.array(aug_buffer))
                        y_train.append(class_label)

                    X_train.append(np.array(buffer))
                    y_train.append(class_label)

            X_train = np.array(X_train)
            y_train = np.array(y_train)

            idx = np.random.permutation(len(X_train))
            X_train, y_train = X_train[idx], y_train[idx]

            save_path = f"repquest/data/{self.exercise_name}" if self.on_colab else f"data/{self.exercise_name}"
            os.makedirs(save_path, exist_ok=True)
            np.save(f"{save_path}/X.npy", X_train)
            np.save(f"{save_path}/y.npy", y_train)

        return folders
    
    def train(self, optimizer, epochs, batch_size, shuffle, data_dir, loss):

        # model checkpoint
        model_checkpoint = tf.keras.callbacks.ModelCheckpoint(
            f'drive/MyDrive/colab_checkpoints/{self.exercise_name}.keras' if self.on_colab else f'models/{self.exercise_name}.keras',
            monitor='val_loss',
            save_best_only=True,
            save_weights_only=False,
            verbose=1
        )

        # early stopping 
        early_stopping = tf.keras.callbacks.EarlyStopping(
            monitor='val_loss',
            patience=7,
            restore_best_weights=True
        )

        self.callbacks = [model_checkpoint, early_stopping]
        
        self.optimizer = optimizer
        self.epochs = epochs
        self.batch_size = batch_size
        self.shuffle = shuffle
        self.loss = loss

        # load data
        X = np.load(f"{data_dir}/X.npy")
        y = np.load(f"{data_dir}/y.npy")

        self.model.compile(
            self.optimizer,
            self.loss,
            metrics=['accuracy']
        )

        self.model.fit(
            X,
            y,
            epochs=self.epochs,
            shuffle=self.shuffle,
            validation_split=0.15,
            batch_size=self.batch_size,
            callbacks=self.callbacks,
        )