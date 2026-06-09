import ExpoModulesCore
import AVFoundation

public class ExpoDualCameraModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ExpoDualCamera")

    // Surfaced to JS as ExpoDualCamera.isSupported — gates the "Dual" camera mode.
    Constants([
      "isSupported": AVCaptureMultiCamSession.isMultiCamSupported
    ])

    View(ExpoDualCameraView.self) {
      Events("onInitError")

      Prop("mirrorFront") { (view: ExpoDualCameraView, value: Bool) in
        view.setMirrorFront(value)
      }

      // `layout` is accepted for forward-compat; only sideBySide is implemented.
      Prop("layout") { (_: ExpoDualCameraView, _: String) in }

      AsyncFunction("capturePhoto") { (view: ExpoDualCameraView, promise: Promise) in
        view.capturePhoto(promise)
      }
    }
  }
}
