import ExpoModulesCore
import AVFoundation
import UIKit

// Side-by-side simultaneous front+back capture built on AVCaptureMultiCamSession.
//
// Architecture (mirrors Apple's AVMultiCamPiP sample):
//   - One AVCaptureMultiCamSession with the back and front wide-angle cameras
//     added via addInputWithNoConnections (multi-cam requires explicit connections).
//   - Two AVCaptureVideoPreviewLayers, each wired to its input's video port.
//   - Two AVCapturePhotoOutputs for stills; on capture we fire both and composite
//     the two JPEGs left|right into a single image.
//
// NOTE: This compiles against the iOS SDK but has NOT been run on-device from the
// authoring environment. Multi-cam needs a physical A12+ iPhone (iOS 13+); expect
// to iterate on session/hardware-cost tuning when you first run it via an EAS dev build.
class ExpoDualCameraView: ExpoView {
  private let session = AVCaptureMultiCamSession()
  private let sessionQueue = DispatchQueue(label: "expo.dualcamera.session")

  private let backPreviewLayer = AVCaptureVideoPreviewLayer()
  private let frontPreviewLayer = AVCaptureVideoPreviewLayer()

  private let backPhotoOutput = AVCapturePhotoOutput()
  private let frontPhotoOutput = AVCapturePhotoOutput()

  private var configured = false
  private var mirrorFront = true

  // In-flight capture coordination: collect both halves before compositing.
  private var pendingPromise: Promise?
  private var pendingBack: UIImage?
  private var pendingFront: UIImage?
  private var pendingExpected = 0
  private var pendingReceived = 0
  private let captureLock = NSLock()
  private var backDelegate: PhotoCaptureDelegate?
  private var frontDelegate: PhotoCaptureDelegate?

  let onInitError = EventDispatcher()

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    backgroundColor = .black
    backPreviewLayer.videoGravity = .resizeAspectFill
    frontPreviewLayer.videoGravity = .resizeAspectFill
    layer.addSublayer(backPreviewLayer)
    layer.addSublayer(frontPreviewLayer)
    sessionQueue.async { [weak self] in self?.configureSession() }
  }

  deinit {
    sessionQueue.async { [session] in
      if session.isRunning { session.stopRunning() }
    }
  }

  func setMirrorFront(_ value: Bool) {
    mirrorFront = value
    if let conn = frontPreviewLayer.connection {
      conn.automaticallyAdjustsVideoMirroring = false
      conn.isVideoMirrored = value
    }
  }

  // MARK: - Layout

  override func layoutSubviews() {
    super.layoutSubviews()
    let half = bounds.width / 2
    backPreviewLayer.frame = CGRect(x: 0, y: 0, width: half, height: bounds.height)
    frontPreviewLayer.frame = CGRect(x: half, y: 0, width: half, height: bounds.height)
  }

  // MARK: - Session configuration

  private func emitInitError(_ message: String) {
    DispatchQueue.main.async { [weak self] in self?.onInitError(["message": message]) }
  }

  private func configureSession() {
    guard AVCaptureMultiCamSession.isMultiCamSupported else {
      emitInitError("Multi-cam is not supported on this device")
      return
    }

    session.beginConfiguration()

    guard configureCamera(position: .back, previewLayer: backPreviewLayer, photoOutput: backPhotoOutput, mirror: false),
          configureCamera(position: .front, previewLayer: frontPreviewLayer, photoOutput: frontPhotoOutput, mirror: mirrorFront) else {
      session.commitConfiguration()
      return
    }

    session.commitConfiguration()
    configured = true
    session.startRunning()
  }

  /// Adds one camera input with explicit (no-auto) connections to its preview layer and photo output.
  private func configureCamera(position: AVCaptureDevice.Position,
                               previewLayer: AVCaptureVideoPreviewLayer,
                               photoOutput: AVCapturePhotoOutput,
                               mirror: Bool) -> Bool {
    guard let device = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: position),
          let input = try? AVCaptureDeviceInput(device: device),
          session.canAddInput(input) else {
      emitInitError("Could not open the \(position == .back ? "back" : "front") camera")
      return false
    }
    session.addInputWithNoConnections(input)

    guard let port = input.ports(for: .video,
                                 sourceDeviceType: device.deviceType,
                                 sourceDevicePosition: position).first else {
      emitInitError("No video port for the \(position == .back ? "back" : "front") camera")
      return false
    }

    // Preview connection
    let previewConn = AVCaptureConnection(inputPort: port, videoPreviewLayer: previewLayer)
    guard session.canAddConnection(previewConn) else {
      emitInitError("Hardware can't run both previews at once (cost limit)")
      return false
    }
    session.addConnection(previewConn)
    if mirror {
      previewConn.automaticallyAdjustsVideoMirroring = false
      previewConn.isVideoMirrored = true
    }

    // Photo output connection
    guard session.canAddOutput(photoOutput) else {
      emitInitError("Could not add the \(position == .back ? "back" : "front") photo output")
      return false
    }
    session.addOutputWithNoConnections(photoOutput)
    let photoConn = AVCaptureConnection(inputPorts: [port], output: photoOutput)
    if mirror {
      photoConn.automaticallyAdjustsVideoMirroring = false
      photoConn.isVideoMirrored = true
    }
    guard session.canAddConnection(photoConn) else {
      emitInitError("Hardware can't run both photo outputs at once (cost limit)")
      return false
    }
    session.addConnection(photoConn)
    return true
  }

  // MARK: - Capture

  func capturePhoto(_ promise: Promise) {
    sessionQueue.async { [weak self] in
      guard let self = self else { return }
      guard self.configured else {
        promise.reject("ERR_NOT_READY", "Dual camera session is not running")
        return
      }
      self.captureLock.lock()
      if self.pendingPromise != nil {
        self.captureLock.unlock()
        promise.reject("ERR_BUSY", "A capture is already in progress")
        return
      }
      self.pendingPromise = promise
      self.pendingBack = nil
      self.pendingFront = nil
      self.pendingReceived = 0
      self.pendingExpected = 2
      self.captureLock.unlock()

      self.backDelegate = PhotoCaptureDelegate { [weak self] image in
        self?.onHalfCaptured(image, isBack: true)
      }
      self.frontDelegate = PhotoCaptureDelegate { [weak self] image in
        self?.onHalfCaptured(image, isBack: false)
      }

      self.backPhotoOutput.capturePhoto(with: AVCapturePhotoSettings(), delegate: self.backDelegate!)
      self.frontPhotoOutput.capturePhoto(with: AVCapturePhotoSettings(), delegate: self.frontDelegate!)
    }
  }

  private func onHalfCaptured(_ image: UIImage?, isBack: Bool) {
    captureLock.lock()
    if isBack { pendingBack = image } else { pendingFront = image }
    pendingReceived += 1
    let done = pendingReceived >= pendingExpected
    let promise = pendingPromise
    let back = pendingBack
    let front = pendingFront
    if done {
      pendingPromise = nil
      backDelegate = nil
      frontDelegate = nil
    }
    captureLock.unlock()

    guard done, let promise = promise else { return }

    guard let back = back, let front = front,
          let composite = ExpoDualCameraView.composeSideBySide(left: back, right: front),
          let data = composite.jpegData(compressionQuality: 0.9) else {
      promise.reject("ERR_COMPOSITE", "Failed to composite the dual photo")
      return
    }

    let url = FileManager.default.temporaryDirectory
      .appendingPathComponent("dual-\(UUID().uuidString).jpg")
    do {
      try data.write(to: url)
      promise.resolve([
        "uri": url.absoluteString,
        "width": composite.size.width,
        "height": composite.size.height,
      ])
    } catch {
      promise.reject("ERR_WRITE", "Failed to write the dual photo: \(error.localizedDescription)")
    }
  }

  /// Composite two images left|right into one, normalizing to the shorter height.
  static func composeSideBySide(left: UIImage, right: UIImage) -> UIImage? {
    let h = min(left.size.height, right.size.height)
    let leftW = left.size.width * (h / left.size.height)
    let rightW = right.size.width * (h / right.size.height)
    let size = CGSize(width: leftW + rightW, height: h)

    let format = UIGraphicsImageRendererFormat.default()
    format.scale = 1
    let renderer = UIGraphicsImageRenderer(size: size, format: format)
    return renderer.image { _ in
      left.draw(in: CGRect(x: 0, y: 0, width: leftW, height: h))
      right.draw(in: CGRect(x: leftW, y: 0, width: rightW, height: h))
    }
  }
}

/// Minimal AVCapturePhotoCaptureDelegate that hands back a decoded UIImage.
private class PhotoCaptureDelegate: NSObject, AVCapturePhotoCaptureDelegate {
  private let completion: (UIImage?) -> Void
  init(completion: @escaping (UIImage?) -> Void) { self.completion = completion }

  func photoOutput(_ output: AVCapturePhotoOutput,
                   didFinishProcessingPhoto photo: AVCapturePhoto,
                   error: Error?) {
    guard error == nil, let data = photo.fileDataRepresentation(), let image = UIImage(data: data) else {
      completion(nil)
      return
    }
    completion(image)
  }
}
