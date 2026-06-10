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

      // Lens arrangement: "sideBySide" (back|front halves) or "pip" (front bubble over back).
      Prop("layout") { (view: ExpoDualCameraView, value: String) in
        view.setLayout(value)
      }

      AsyncFunction("capturePhoto") { (view: ExpoDualCameraView, promise: Promise) in
        view.capturePhoto(promise)
      }
    }
  }
}
