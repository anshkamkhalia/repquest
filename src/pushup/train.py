from src.universal_trainer import Exercise
from src.pushup.model import Pushup
import tensorflow as tf

model = Pushup()
optimizer = tf.keras.optimizers.Adam(1e-3)
epochs = 100
batch_size = 16
shuffle = True
loss = "sparse_categorical_crossentropy"
data_dir = "data/pushup"

trainer = Exercise(exercise_name="pushup", model=model, on_colab=False)
trainer.data_preprocess(1000)
trainer.train(optimizer, epochs, batch_size, shuffle, data_dir, loss)