package expo.modules.dualcamera

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class ExpoDualCameraModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("ExpoDualCamera")

    // Android: dual capture is not supported by this module (see ExpoDualCameraView).
    Constants(
      "isSupported" to false
    )

    View(ExpoDualCameraView::class) {
      Events("onInitError")
      Prop("mirrorFront") { _: ExpoDualCameraView, _: Boolean -> }
      Prop("layout") { _: ExpoDualCameraView, _: String -> }
    }
  }
}
