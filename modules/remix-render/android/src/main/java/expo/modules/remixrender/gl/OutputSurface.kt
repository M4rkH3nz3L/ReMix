package expo.modules.remixrender.gl

import android.graphics.SurfaceTexture
import android.os.Handler
import android.os.HandlerThread
import android.view.Surface

/**
 * A dekóder kimeneti `Surface`-ét adja (egy `SurfaceTexture` köré), majd az új
 * képkockát az aktuális EGL-kontextusban (az enkóder input-surface-ére) rajzolja
 * a [TextureRender]-rel. A frame-available callbackot saját `HandlerThread`-en
 * kapja, hogy a hívó (render) szál blokkolhasson a kép megérkezésére anélkül,
 * hogy a callback-szálra lenne szüksége. A CTS `OutputSurface` mintája.
 *
 * Fontos: a példányt az enkóder EGL-kontextusának aktuálissá tétele UTÁN kell
 * létrehozni (a textúra ott jön létre).
 */
class OutputSurface : SurfaceTexture.OnFrameAvailableListener {
  private val textureRender = TextureRender()
  private val surfaceTexture: SurfaceTexture
  val surface: Surface

  private val frameSyncObject = Object()
  private var frameAvailable = false

  private val callbackThread = HandlerThread("RemixOutputSurface").apply { start() }
  private val callbackHandler = Handler(callbackThread.looper)

  init {
    textureRender.surfaceCreated()
    surfaceTexture = SurfaceTexture(textureRender.textureId)
    surfaceTexture.setOnFrameAvailableListener(this, callbackHandler)
    surface = Surface(surfaceTexture)
  }

  fun setAspectFill(srcW: Int, srcH: Int, dstW: Int, dstH: Int) =
    textureRender.setAspectFill(srcW, srcH, dstW, dstH)

  fun setFilter(rgb: Int, opacity: Float) = textureRender.setFilter(rgb, opacity)

  /** Blokkol, amíg egy új dekódolt képkocka megérkezik, majd a textúrába tölti. */
  fun awaitNewImage() {
    synchronized(frameSyncObject) {
      while (!frameAvailable) {
        frameSyncObject.wait(TIMEOUT_MS)
        if (!frameAvailable) throw RuntimeException("a dekódolt képkockára várás túllépte az időt")
      }
      frameAvailable = false
    }
    textureRender.checkGlError("updateTexImage előtt")
    surfaceTexture.updateTexImage()
  }

  /** A legutóbbi képkockát az aktuális EGL-surface-ére rajzolja. */
  fun drawImage() = textureRender.drawFrame(surfaceTexture)

  override fun onFrameAvailable(st: SurfaceTexture) {
    synchronized(frameSyncObject) {
      frameAvailable = true
      frameSyncObject.notifyAll()
    }
  }

  fun release() {
    callbackThread.quitSafely()
    surface.release()
    surfaceTexture.release()
  }

  companion object {
    private const val TIMEOUT_MS = 5000L
  }
}
