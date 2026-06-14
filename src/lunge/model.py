import tensorflow as tf

@tf.keras.utils.register_keras_serializable()
class Lunge(tf.keras.Model):
    def __init__(self, num_heads=4, key_dim=32, **kwargs):
        super().__init__(**kwargs)

        self.conv1 = tf.keras.layers.Conv1D(32, 3, activation="relu", padding="same")
        self.pool1 = tf.keras.layers.MaxPooling1D()

        self.conv2 = tf.keras.layers.Conv1D(64, 3, activation="relu", padding="same")
        self.pool2 = tf.keras.layers.MaxPooling1D()

        self.mha1 = tf.keras.layers.MultiHeadAttention(num_heads=num_heads, key_dim=key_dim)
        self.norm1 = tf.keras.layers.LayerNormalization()

        self.mha2 = tf.keras.layers.MultiHeadAttention(num_heads=num_heads, key_dim=key_dim)
        self.norm2 = tf.keras.layers.LayerNormalization()

        self.bn = tf.keras.layers.BatchNormalization()
        self.gap = tf.keras.layers.GlobalAveragePooling1D()

        self.dense1 = tf.keras.layers.Dense(128, activation="relu")
        self.dropout = tf.keras.layers.Dropout(0.2)
        self.dense2 = tf.keras.layers.Dense(256, activation="relu")
        self.out = tf.keras.layers.Dense(3, activation="softmax")

    def call(self, x, training=False):
        x = self.conv1(x)
        x = self.pool1(x)

        x = self.conv2(x)
        x = self.pool2(x)

        attn1 = self.mha1(x, x, training=training)
        x = self.norm1(x + attn1)

        attn2 = self.mha2(x, x, training=training)
        x = self.norm2(x + attn2)

        x = self.bn(x, training=training)

        x = self.gap(x)

        x = self.dense1(x)
        x = self.dropout(x, training=training)
        x = self.dense2(x)

        return self.out(x)
    
import tensorflow as tf

def build_lunge_model(input_shape=(106, 110), num_heads=4, key_dim=32):

    inputs = tf.keras.Input(shape=input_shape)

    x = tf.keras.layers.Conv1D(32, 3, padding="same", activation="relu")(inputs)
    x = tf.keras.layers.MaxPooling1D()(x)

    x = tf.keras.layers.Conv1D(64, 3, padding="same", activation="relu")(x)
    x = tf.keras.layers.MaxPooling1D()(x)

    attn1 = tf.keras.layers.MultiHeadAttention(
        num_heads=num_heads,
        key_dim=key_dim
    )(x, x)

    x = tf.keras.layers.Add()([x, attn1])
    x = tf.keras.layers.LayerNormalization()(x)

    attn2 = tf.keras.layers.MultiHeadAttention(
        num_heads=num_heads,
        key_dim=key_dim
    )(x, x)

    x = tf.keras.layers.Add()([x, attn2])
    x = tf.keras.layers.LayerNormalization()(x)

    x = tf.keras.layers.BatchNormalization()(x)

    x = tf.keras.layers.GlobalAveragePooling1D()(x)

    x = tf.keras.layers.Dense(128, activation="relu")(x)
    x = tf.keras.layers.Dropout(0.2)(x)
    x = tf.keras.layers.Dense(256, activation="relu")(x)

    outputs = tf.keras.layers.Dense(3, activation="softmax")(x)

    model = tf.keras.Model(inputs, outputs)

    return model