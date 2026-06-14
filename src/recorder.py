# only records and stores VIDEOS

import cv2 as cv
import os

exercise = "angled_back_lunge"
SAVE_ROOT = "video_data/lunge"
SAVE_DIR = os.path.join(SAVE_ROOT, exercise)

# create
os.makedirs(SAVE_ROOT, exist_ok=True)
os.makedirs(SAVE_DIR, exist_ok=True)

# get current number of files in folder
existing = [
    f for f in os.listdir(SAVE_DIR)
    if f.endswith(".mp4")
]

indices = [
    int(f.split("_")[-1].split(".")[0])
    for f in existing
    if f.split("_")[-1].split(".")[0].isdigit()
]

n_files = max(indices) + 1 if indices else 0

# read video input
cap = cv.VideoCapture(0)

# videowriter setting
frame_width = int(cap.get(cv.CAP_PROP_FRAME_WIDTH))
frame_height = int(cap.get(cv.CAP_PROP_FRAME_HEIGHT))
fourcc = cv.VideoWriter_fourcc(*'mp4v')
# fps = int(cap.get(cv.CAP_PROP_FPS))
fps = 30

n_seconds = 3.5
n_frames = int(n_seconds * fps)
frame_idx = 0

# space to start and stop recording
# q to quit

def draw_status(frame, recording, n_files):
    overlay = frame.copy()

    if recording:
        cv.rectangle(overlay, (10, 10), (220, 55), (0, 0, 180), -1)
        cv.rectangle(overlay, (10, 10), (220, 55), (0, 0, 255), 2)
        cv.addWeighted(overlay, 0.75, frame, 0.25, 0, frame)

        cv.circle(frame, (35, 33), 10, (0, 0, 255), -1)
        cv.putText(frame, "RECORDING...", (52, 40),
                   cv.FONT_HERSHEY_DUPLEX, 0.7, (255, 255, 255), 1, cv.LINE_AA)

    else:
        cv.rectangle(overlay, (10, 10), (230, 55), (30, 30, 30), -1)
        cv.rectangle(overlay, (10, 10), (230, 55), (180, 180, 180), 2)
        cv.addWeighted(overlay, 0.7, frame, 0.3, 0, frame)

        cv.putText(frame, f"VIDEO  {n_files} files", (22, 40),
                   cv.FONT_HERSHEY_DUPLEX, 0.7, (0, 255, 180), 1, cv.LINE_AA)

recording = False # recording flag

while True:
    ret, frame = cap.read()
    key = cv.waitKey(1) & 0xFF # check key once
    frame = cv.flip(frame, 1)

    # check for quit
    if key == ord('q'):
        break

    # check for video start
    if key == ord(' '):
        
        if not recording: # now start recording
            frame_idx = 0
            recording = True
            out = cv.VideoWriter(
                os.path.join(SAVE_DIR, f"{exercise}_{n_files}.mp4"),
                fourcc,
                fps,
                (frame_width, frame_height)
            )

    if frame_idx <= n_frames and recording:
        out.write(frame)
        frame_idx += 1
    
    else:
        recording = False
        frame_idx = 0

        try:
            out.release()
        except:
            pass

    existing = [
        f for f in os.listdir(SAVE_DIR)
        if f.endswith(".mp4")
    ]

    indices = [
        int(f.split("_")[-1].split(".")[0])
        for f in existing
        if f.split("_")[-1].split(".")[0].isdigit()
    ]

    n_files = max(indices) + 1 if indices else 0
    draw_status(frame, recording, n_files)
    cv.imshow("frame", frame)

cap.release()