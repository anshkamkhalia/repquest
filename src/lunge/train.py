from src.universal_trainer import Exercise
from src.lunge.model import Lunge
import tensorflow as tf

model = Lunge()
optimizer = tf.keras.optimizers.Adam(1e-3)
epochs = 100
batch_size = 16
shuffle = True
loss = "sparse_categorical_crossentropy"
data_dir = "data/lunge"

trainer = Exercise(exercise_name="lunge", model=model, on_colab=False)
trainer.data_preprocess(1000)
trainer.train(optimizer, epochs, batch_size, shuffle, data_dir, loss)