from src.universal_trainer import Exercise
from src.squat.model import Squat
import tensorflow as tf

model = Squat()
optimizer = tf.keras.optimizers.Adam(1e-3)
epochs = 100
batch_size = 16
shuffle = True
loss = "binary_crossentropy"
data_dir = "data/squat"

trainer = Exercise(exercise_name="squat", model=model, on_colab=False)
trainer.data_preprocess(1000)
trainer.train(optimizer, epochs, batch_size, shuffle, data_dir, loss)