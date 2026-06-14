# converts .keras models into the tflite format

import tensorflow as tf
import os
from src.lunge.model import Lunge, build_lunge_model
from src.squat.model import Squat, build_squat_model
from src.pushup.model import Pushup, build_pushup_model

os.makedirs("tflite_models", exist_ok=True)

models = ["pushup", "squat", "lunge"]

custom_objects = {
    "pushup": {"Pushup": Pushup},
    "lunge": {"Lunge": Lunge},
    "squat": {"Squat": Squat},
}

for exercise in models:

    old_model = tf.keras.models.load_model(f"models/{exercise}.keras", custom_objects=custom_objects[exercise])
    if exercise == "pushup":
        model = build_pushup_model()
    elif exercise == "lunge":
        model = build_lunge_model()
    else:
        model = build_squat_model()
    model.set_weights(old_model.get_weights())
    converter = tf.lite.TFLiteConverter.from_keras_model(model)
    converter.optimizations = [tf.lite.Optimize.DEFAULT]
    converter.target_spec.supported_types = [tf.float16]
    tflite_model = converter.convert()
    with open(f"tflite_models/{exercise}.tflite", "wb") as f:
        f.write(tflite_model)
    interpreter = tf.lite.Interpreter(model_path=f"tflite_models/{exercise}.tflite")
    interpreter.allocate_tensors()
    input_details = interpreter.get_input_details()
    output_details = interpreter.get_output_details()
    print("INPUT:", input_details)
    print("OUTPUT:", output_details)