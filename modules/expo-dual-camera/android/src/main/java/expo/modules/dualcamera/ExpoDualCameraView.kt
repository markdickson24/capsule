package expo.modules.dualcamera

import android.content.Context
import android.graphics.Color
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.views.ExpoView

// Android concurrent dual-camera (CameraManager.getConcurrentCameraIds) is rare and
// device-specific, so this module reports isSupported=false on Android and the JS
// layer hides the Dual mode. This view is a black placeholder kept only so the
// module registers on both platforms; it is never rendered while isSupported=false.
class ExpoDualCameraView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  init {
    setBackgroundColor(Color.BLACK)
  }
}
