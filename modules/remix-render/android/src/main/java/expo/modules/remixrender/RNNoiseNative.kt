package expo.modules.remixrender

/** 🔇 V8: az RNNoise C-mag (libremixrnnoise) — a ../ios/rnnoise forrásokból, a RemixRNNoise.h felületen át */
object RNNoiseNative {
  init {
    System.loadLibrary("remixrnnoise")
  }

  @JvmStatic external fun load(blob: ByteArray): Int
  @JvmStatic external fun create(): Long
  @JvmStatic external fun process(state: Long, input: FloatArray, output: FloatArray, frames: Int): Float
  @JvmStatic external fun destroy(state: Long)
  @JvmStatic external fun frameSize(): Int
  @JvmStatic external fun resamplerCreate(up: Int, down: Int, half: Int, table: FloatArray): Long
  @JvmStatic external fun resamplerProcess(r: Long, input: FloatArray, n: Int, output: FloatArray): Int
  @JvmStatic external fun resamplerFlush(r: Long, output: FloatArray): Int
  @JvmStatic external fun resamplerDestroy(r: Long)
}
