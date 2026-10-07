package expo.modules.remixrender.gl

import android.graphics.SurfaceTexture
import android.opengl.GLES11Ext
import android.opengl.GLES20
import android.opengl.Matrix
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.FloatBuffer

/**
 * A dekóder külső-OES textúráját (SurfaceTexture) egy teljes-vászon quadra rajzolja
 * az enkóder input-surface-ére. A forrás képarányát megtartja (**aspect-fill** =
 * a vászon kitöltése középre-vágással), a `SurfaceTexture` transzform-mátrixát a
 * textúra-koordinátákra alkalmazva (forgatás/crop a forrás metaadatából).
 *
 * A CTS `ExtractDecodeEditEncodeMuxTest` / Grafika `TextureRender` mintáját követi.
 */
class TextureRender {
  private val triangleVerticesData = floatArrayOf(
    // X,   Y,  Z,  U, V
    -1f, -1f, 0f, 0f, 0f,
    1f, -1f, 0f, 1f, 0f,
    -1f, 1f, 0f, 0f, 1f,
    1f, 1f, 0f, 1f, 1f,
  )
  private val triangleVertices: FloatBuffer = ByteBuffer
    .allocateDirect(triangleVerticesData.size * FLOAT_SIZE)
    .order(ByteOrder.nativeOrder())
    .asFloatBuffer()
    .apply { put(triangleVerticesData); position(0) }

  private val mvpMatrix = FloatArray(16)
  private val stMatrix = FloatArray(16)
  private var program = 0
  var textureId = -12345
    private set
  private var uMVPMatrixHandle = 0
  private var uSTMatrixHandle = 0
  private var aPositionHandle = 0
  private var aTextureHandle = 0

  init {
    Matrix.setIdentityM(mvpMatrix, 0)
    Matrix.setIdentityM(stMatrix, 0)
  }

  /** Aspect-fill skála a forrás (display) és a cél-vászon méretéből. */
  fun setAspectFill(srcW: Int, srcH: Int, dstW: Int, dstH: Int) {
    Matrix.setIdentityM(mvpMatrix, 0)
    if (srcW <= 0 || srcH <= 0 || dstW <= 0 || dstH <= 0) return
    val srcA = srcW.toFloat() / srcH.toFloat()
    val dstA = dstW.toFloat() / dstH.toFloat()
    if (srcA > dstA) {
      Matrix.scaleM(mvpMatrix, 0, srcA / dstA, 1f, 1f) // túllóg oldalt → crop
    } else {
      Matrix.scaleM(mvpMatrix, 0, 1f, dstA / srcA, 1f) // túllóg fent/lent → crop
    }
  }

  fun drawFrame(st: SurfaceTexture) {
    checkGlError("onDrawFrame start")
    st.getTransformMatrix(stMatrix)
    GLES20.glClearColor(0f, 0f, 0f, 1f)
    GLES20.glClear(GLES20.GL_DEPTH_BUFFER_BIT or GLES20.GL_COLOR_BUFFER_BIT)
    GLES20.glUseProgram(program)
    checkGlError("glUseProgram")
    GLES20.glActiveTexture(GLES20.GL_TEXTURE0)
    GLES20.glBindTexture(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, textureId)

    triangleVertices.position(POS_OFFSET)
    GLES20.glVertexAttribPointer(aPositionHandle, 3, GLES20.GL_FLOAT, false, STRIDE, triangleVertices)
    GLES20.glEnableVertexAttribArray(aPositionHandle)
    triangleVertices.position(UV_OFFSET)
    GLES20.glVertexAttribPointer(aTextureHandle, 2, GLES20.GL_FLOAT, false, STRIDE, triangleVertices)
    GLES20.glEnableVertexAttribArray(aTextureHandle)

    GLES20.glUniformMatrix4fv(uMVPMatrixHandle, 1, false, mvpMatrix, 0)
    GLES20.glUniformMatrix4fv(uSTMatrixHandle, 1, false, stMatrix, 0)
    GLES20.glDrawArrays(GLES20.GL_TRIANGLE_STRIP, 0, 4)
    checkGlError("glDrawArrays")
    GLES20.glFinish()
  }

  fun surfaceCreated() {
    program = createProgram(VERTEX_SHADER, FRAGMENT_SHADER)
    if (program == 0) throw RuntimeException("shader-program nem jött létre")
    aPositionHandle = GLES20.glGetAttribLocation(program, "aPosition")
    aTextureHandle = GLES20.glGetAttribLocation(program, "aTextureCoord")
    uMVPMatrixHandle = GLES20.glGetUniformLocation(program, "uMVPMatrix")
    uSTMatrixHandle = GLES20.glGetUniformLocation(program, "uSTMatrix")

    val textures = IntArray(1)
    GLES20.glGenTextures(1, textures, 0)
    textureId = textures[0]
    GLES20.glBindTexture(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, textureId)
    GLES20.glTexParameterf(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, GLES20.GL_TEXTURE_MIN_FILTER, GLES20.GL_LINEAR.toFloat())
    GLES20.glTexParameterf(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, GLES20.GL_TEXTURE_MAG_FILTER, GLES20.GL_LINEAR.toFloat())
    GLES20.glTexParameteri(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, GLES20.GL_TEXTURE_WRAP_S, GLES20.GL_CLAMP_TO_EDGE)
    GLES20.glTexParameteri(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, GLES20.GL_TEXTURE_WRAP_T, GLES20.GL_CLAMP_TO_EDGE)
    checkGlError("glTexParameter")
  }

  private fun loadShader(type: Int, source: String): Int {
    val shader = GLES20.glCreateShader(type)
    GLES20.glShaderSource(shader, source)
    GLES20.glCompileShader(shader)
    val compiled = IntArray(1)
    GLES20.glGetShaderiv(shader, GLES20.GL_COMPILE_STATUS, compiled, 0)
    if (compiled[0] == 0) {
      val log = GLES20.glGetShaderInfoLog(shader)
      GLES20.glDeleteShader(shader)
      throw RuntimeException("shader-fordítási hiba ($type): $log")
    }
    return shader
  }

  private fun createProgram(vertexSource: String, fragmentSource: String): Int {
    val vs = loadShader(GLES20.GL_VERTEX_SHADER, vertexSource)
    val fs = loadShader(GLES20.GL_FRAGMENT_SHADER, fragmentSource)
    val prog = GLES20.glCreateProgram()
    GLES20.glAttachShader(prog, vs)
    GLES20.glAttachShader(prog, fs)
    GLES20.glLinkProgram(prog)
    val status = IntArray(1)
    GLES20.glGetProgramiv(prog, GLES20.GL_LINK_STATUS, status, 0)
    if (status[0] != GLES20.GL_TRUE) {
      val log = GLES20.glGetProgramInfoLog(prog)
      GLES20.glDeleteProgram(prog)
      throw RuntimeException("program-linkelési hiba: $log")
    }
    return prog
  }

  fun checkGlError(op: String) {
    val error = GLES20.glGetError()
    if (error != GLES20.GL_NO_ERROR) {
      throw RuntimeException("$op: glError $error")
    }
  }

  companion object {
    private const val FLOAT_SIZE = 4
    private const val STRIDE = 5 * FLOAT_SIZE
    private const val POS_OFFSET = 0
    private const val UV_OFFSET = 3

    private const val VERTEX_SHADER =
      "uniform mat4 uMVPMatrix;\n" +
        "uniform mat4 uSTMatrix;\n" +
        "attribute vec4 aPosition;\n" +
        "attribute vec4 aTextureCoord;\n" +
        "varying vec2 vTextureCoord;\n" +
        "void main() {\n" +
        "  gl_Position = uMVPMatrix * aPosition;\n" +
        "  vTextureCoord = (uSTMatrix * aTextureCoord).xy;\n" +
        "}\n"

    private const val FRAGMENT_SHADER =
      "#extension GL_OES_EGL_image_external : require\n" +
        "precision mediump float;\n" +
        "varying vec2 vTextureCoord;\n" +
        "uniform samplerExternalOES sTexture;\n" +
        "void main() {\n" +
        "  gl_FragColor = texture2D(sTexture, vTextureCoord);\n" +
        "}\n"
  }
}
