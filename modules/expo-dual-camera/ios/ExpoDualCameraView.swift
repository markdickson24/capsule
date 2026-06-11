import ExpoModulesCore
import AVFoundation
import CoreMedia
import CoreImage
import UIKit

// Simultaneous front+back capture on AVCaptureMultiCamSession — the same API
// Snapchat's dual camera and Apple's AVMultiCamPiP sample are built on.
//
// Capture path mirrors Apple's sample: each lens streams through a cheap
// AVCaptureVideoDataOutput, and on shutter we grab the next frame from each and
// composite them. We deliberately avoid two AVCapturePhotoOutputs — those reserve
// full-resolution still budget and overrun the shared multi-cam hardware cost,
// which is what produced the "cost limit" failure.
class ExpoDualCameraView: ExpoView {
  private let session = AVCaptureMultiCamSession()
  private let sessionQueue = DispatchQueue(label: "expo.dualcamera.session")
  private let dataQueue = DispatchQueue(label: "expo.dualcamera.data")

  private let backPreviewLayer = AVCaptureVideoPreviewLayer()
  private let frontPreviewLayer = AVCaptureVideoPreviewLayer()

  private let backVideoOutput = AVCaptureVideoDataOutput()
  private let frontVideoOutput = AVCaptureVideoDataOutput()
  private var backGrabber: FrameGrabber?
  private var frontGrabber: FrameGrabber?

  private var configured = false
  private var mirrorFront = true

  // Kept so we can throttle frame rate post-commit if the combined hardware cost
  // still exceeds the multi-cam budget.
  private var activeDevices: [AVCaptureDevice] = []

  // Lens arrangement. `sideBySide` = back|front halves; `pip` = full back with a
  // small front bubble in the top-right corner (Snapchat-style).
  enum Layout: String { case sideBySide, pip }
  private var layout: Layout = .sideBySide

  // PiP geometry, expressed as fractions of the view's width so preview + composite stay in sync.
  private static let pipWidthRatio: CGFloat = 0.30
  private static let pipMarginRatio: CGFloat = 0.04
  private static let pipCornerRatio: CGFloat = 0.12 // of the bubble width
  private static let pipAspect: CGFloat = 4.0 / 3.0 // height / width (portrait still)

  // In-flight capture: grab the next frame from each lens, then composite.
  private var pendingPromise: Promise?
  private var pendingBack: UIImage?
  private var pendingFront: UIImage?
  private let captureLock = NSLock()
  private let ciContext = CIContext(options: nil)

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

  func setLayout(_ value: String) {
    layout = Layout(rawValue: value) ?? .sideBySide
    DispatchQueue.main.async { [weak self] in self?.setNeedsLayout() }
  }

  // MARK: - Layout

  override func layoutSubviews() {
    super.layoutSubviews()
    switch layout {
    case .sideBySide:
      // Reset any PiP styling on the front layer.
      frontPreviewLayer.cornerRadius = 0
      frontPreviewLayer.borderWidth = 0
      frontPreviewLayer.masksToBounds = false
      let half = bounds.width / 2
      backPreviewLayer.frame = CGRect(x: 0, y: 0, width: half, height: bounds.height)
      frontPreviewLayer.frame = CGRect(x: half, y: 0, width: half, height: bounds.height)
    case .pip:
      backPreviewLayer.frame = bounds
      let w = bounds.width * Self.pipWidthRatio
      let h = w * Self.pipAspect
      let margin = bounds.width * Self.pipMarginRatio
      // Top-right, nudged down so it clears the RN top bar overlay.
      let y = max(margin, safeAreaInsets.top + margin + 36)
      frontPreviewLayer.frame = CGRect(x: bounds.width - margin - w, y: y, width: w, height: h)
      frontPreviewLayer.cornerRadius = w * Self.pipCornerRatio
      frontPreviewLayer.borderWidth = max(1, bounds.width * 0.005)
      frontPreviewLayer.borderColor = UIColor.white.cgColor
      frontPreviewLayer.masksToBounds = true
    }
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

    backGrabber = FrameGrabber { [weak self] buf in self?.onFrame(buf, isBack: true) }
    frontGrabber = FrameGrabber { [weak self] buf in self?.onFrame(buf, isBack: false) }

    guard configureCamera(position: .back, previewLayer: backPreviewLayer, videoOutput: backVideoOutput, grabber: backGrabber!, mirror: false),
          configureCamera(position: .front, previewLayer: frontPreviewLayer, videoOutput: frontVideoOutput, grabber: frontGrabber!, mirror: mirrorFront) else {
      session.commitConfiguration()
      return
    }

    session.commitConfiguration()

    // Belt-and-suspenders: if both lenses still overrun the budget, step the frame
    // rate down until the session fits (connections are already attached).
    reduceHardwareCostIfNeeded()

    configured = true
    session.startRunning()
  }

  /// Drops the capture frame rate on both lenses until `hardwareCost`/`systemPressureCost`
  /// fall within budget. Only kicks in if the chosen formats weren't enough on their own.
  private func reduceHardwareCostIfNeeded() {
    for fps in [24.0, 20.0, 15.0, 12.0] {
      if session.hardwareCost <= 1.0 && session.systemPressureCost <= 1.0 { return }
      setFrameRate(fps)
    }
  }

  /// Clamp every active lens to `fps` (never below the format's own minimum).
  private func setFrameRate(_ fps: Double) {
    let dur = CMTime(value: 1, timescale: Int32(fps))
    for device in activeDevices {
      guard let range = device.activeFormat.videoSupportedFrameRateRanges.first else { continue }
      let clamped = CMTimeMaximum(dur, range.minFrameDuration)
      if (try? device.lockForConfiguration()) != nil {
        device.activeVideoMinFrameDuration = clamped
        device.activeVideoMaxFrameDuration = clamped
        device.unlockForConfiguration()
      }
    }
  }

  /// Picks the cheapest usable multi-cam format and caps it at 24fps. Multi-cam shares
  /// one hardware budget across both lenses, so we prefer *binned* formats (lower power)
  /// and keep resolution modest — leaving headroom is what stops the second lens failing
  /// with the "cost limit" error.
  private func applyMultiCamFormat(to device: AVCaptureDevice, maxWidth: Int32 = 1280) {
    let multiCam = device.formats.filter { $0.isMultiCamSupported }
    guard !multiCam.isEmpty else { return }
    func width(_ f: AVCaptureDevice.Format) -> Int32 {
      CMVideoFormatDescriptionGetDimensions(f.formatDescription).width
    }
    // Binned formats draw far less hardware cost; fall back to all multi-cam formats.
    let binned = multiCam.filter { $0.isVideoBinned }
    let pool = binned.isEmpty ? multiCam : binned
    let chosen = pool.filter { width($0) <= maxWidth }.max(by: { width($0) < width($1) })
      ?? pool.min(by: { width($0) < width($1) })
    guard let format = chosen, (try? device.lockForConfiguration()) != nil else { return }
    device.activeFormat = format
    if let range = format.videoSupportedFrameRateRanges.first {
      let cap = CMTimeMaximum(CMTime(value: 1, timescale: 24), range.minFrameDuration)
      device.activeVideoMinFrameDuration = cap
      device.activeVideoMaxFrameDuration = cap
    }
    device.unlockForConfiguration()
  }

  /// Adds one camera: input (no auto connections) + a preview-layer connection for the
  /// live feed and a video-data-output connection that supplies frames for capture.
  private func configureCamera(position: AVCaptureDevice.Position,
                               previewLayer: AVCaptureVideoPreviewLayer,
                               videoOutput: AVCaptureVideoDataOutput,
                               grabber: FrameGrabber,
                               mirror: Bool) -> Bool {
    guard let device = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: position),
          let input = try? AVCaptureDeviceInput(device: device),
          session.canAddInput(input) else {
      emitInitError("Could not open the \(position == .back ? "back" : "front") camera")
      return false
    }
    session.addInputWithNoConnections(input)

    // Constrain resolution/frame rate up front so both lenses fit the multi-cam budget.
    applyMultiCamFormat(to: device)
    activeDevices.append(device)

    guard let port = input.ports(for: .video,
                                 sourceDeviceType: device.deviceType,
                                 sourceDevicePosition: position).first else {
      emitInitError("No video port for the \(position == .back ? "back" : "front") camera")
      return false
    }

    // Live preview connection (GPU-cheap).
    let previewConn = AVCaptureConnection(inputPort: port, videoPreviewLayer: previewLayer)
    guard ensureCanAdd(previewConn) else {
      emitInitError("Hardware can't run both previews at once (cost \(String(format: "%.2f", session.hardwareCost)))")
      return false
    }
    session.addConnection(previewConn)
    if mirror {
      previewConn.automaticallyAdjustsVideoMirroring = false
      previewConn.isVideoMirrored = true
    }

    // Video data output — the capture source. Far cheaper than a photo output because
    // it streams the (already small) preview format instead of reserving full-res stills.
    videoOutput.alwaysDiscardsLateVideoFrames = true
    videoOutput.videoSettings = [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA]
    videoOutput.setSampleBufferDelegate(grabber, queue: dataQueue)
    guard session.canAddOutput(videoOutput) else {
      emitInitError("Could not add the \(position == .back ? "back" : "front") video output")
      return false
    }
    session.addOutputWithNoConnections(videoOutput)

    let dataConn = AVCaptureConnection(inputPorts: [port], output: videoOutput)
    if dataConn.isVideoOrientationSupported {
      dataConn.videoOrientation = .portrait
    }
    if mirror {
      dataConn.automaticallyAdjustsVideoMirroring = false
      dataConn.isVideoMirrored = true
    }
    guard ensureCanAdd(dataConn) else {
      emitInitError("Hardware can't run both lenses at once (cost \(String(format: "%.2f", session.hardwareCost)))")
      return false
    }
    session.addConnection(dataConn)
    return true
  }

  /// True if `conn` can be added — stepping the frame rate down on the already-active
  /// lenses to reclaim hardware budget if the first check fails. This turns the hard
  /// "cost limit" failure into a graceful degrade to a lower frame rate.
  private func ensureCanAdd(_ conn: AVCaptureConnection) -> Bool {
    if session.canAddConnection(conn) { return true }
    for fps in [24.0, 20.0, 15.0, 12.0] {
      setFrameRate(fps)
      if session.canAddConnection(conn) { return true }
    }
    return false
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
      // Arm the grab — the next frame from each lens (delivered on dataQueue) is taken.
      self.pendingPromise = promise
      self.pendingBack = nil
      self.pendingFront = nil
      self.captureLock.unlock()

      // Safety: if frames never arrive, don't leave the JS promise hanging.
      self.sessionQueue.asyncAfter(deadline: .now() + 2.0) { [weak self] in
        guard let self = self else { return }
        self.captureLock.lock()
        let stale = self.pendingPromise
        if stale != nil {
          self.pendingPromise = nil
          self.pendingBack = nil
          self.pendingFront = nil
        }
        self.captureLock.unlock()
        stale?.reject("ERR_TIMEOUT", "Dual capture timed out waiting for frames")
      }
    }
  }

  /// Called for every delivered frame. Cheap no-op unless a capture is armed and this
  /// lens hasn't been grabbed yet — then it converts and stores that one frame.
  private func onFrame(_ sampleBuffer: CMSampleBuffer, isBack: Bool) {
    captureLock.lock()
    let wanted = pendingPromise != nil && (isBack ? pendingBack : pendingFront) == nil
    captureLock.unlock()
    guard wanted, let image = imageFromSampleBuffer(sampleBuffer) else { return }

    captureLock.lock()
    guard pendingPromise != nil else { captureLock.unlock(); return }
    if isBack { pendingBack = image } else { pendingFront = image }
    let haveBoth = pendingBack != nil && pendingFront != nil
    let promise = pendingPromise
    let back = pendingBack
    let front = pendingFront
    if haveBoth { pendingPromise = nil }
    captureLock.unlock()

    guard haveBoth, let promise = promise, let b = back, let f = front else { return }
    finishCapture(back: b, front: f, promise: promise)
  }

  private func imageFromSampleBuffer(_ sampleBuffer: CMSampleBuffer) -> UIImage? {
    guard let pixelBuffer = CMSampleBufferGetImageBuffer(sampleBuffer) else { return nil }
    let ci = CIImage(cvPixelBuffer: pixelBuffer)
    guard let cg = ciContext.createCGImage(ci, from: ci.extent) else { return nil }
    return UIImage(cgImage: cg)
  }

  private func finishCapture(back: UIImage, front: UIImage, promise: Promise) {
    let merged: UIImage?
    switch layout {
    case .sideBySide:
      merged = ExpoDualCameraView.composeSideBySide(left: back, right: front)
    case .pip:
      merged = ExpoDualCameraView.composePiP(base: back, inset: front)
    }

    guard let composite = merged,
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

  /// Composite `inset` (front lens, already mirrored by the capture connection) as a
  /// rounded, white-bordered bubble in the top-right corner of full-frame `base` (back lens).
  /// Geometry mirrors the PiP preview layout so the still matches what the user saw.
  static func composePiP(base: UIImage, inset: UIImage) -> UIImage? {
    let canvas = base.size
    guard canvas.width > 0, canvas.height > 0 else { return nil }

    let format = UIGraphicsImageRendererFormat.default()
    format.scale = 1
    let renderer = UIGraphicsImageRenderer(size: canvas, format: format)
    return renderer.image { ctx in
      base.draw(in: CGRect(origin: .zero, size: canvas))

      let w = canvas.width * pipWidthRatio
      let h = w * pipAspect
      let margin = canvas.width * pipMarginRatio
      let rect = CGRect(x: canvas.width - margin - w, y: margin, width: w, height: h)
      let path = UIBezierPath(roundedRect: rect, cornerRadius: w * pipCornerRatio)

      // Aspect-fill the front image into the bubble, clipped to the rounded rect.
      ctx.cgContext.saveGState()
      path.addClip()
      let scale = max(rect.width / inset.size.width, rect.height / inset.size.height)
      let drawW = inset.size.width * scale
      let drawH = inset.size.height * scale
      let drawRect = CGRect(
        x: rect.midX - drawW / 2,
        y: rect.midY - drawH / 2,
        width: drawW, height: drawH)
      inset.draw(in: drawRect)
      ctx.cgContext.restoreGState()

      UIColor.white.setStroke()
      path.lineWidth = max(1, canvas.width * 0.005)
      path.stroke()
    }
  }
}

/// Forwards every delivered video frame to a closure. Held strongly by the view;
/// `setSampleBufferDelegate` keeps only a weak reference.
private class FrameGrabber: NSObject, AVCaptureVideoDataOutputSampleBufferDelegate {
  private let onFrame: (CMSampleBuffer) -> Void
  init(onFrame: @escaping (CMSampleBuffer) -> Void) { self.onFrame = onFrame }

  func captureOutput(_ output: AVCaptureOutput,
                     didOutput sampleBuffer: CMSampleBuffer,
                     from connection: AVCaptureConnection) {
    onFrame(sampleBuffer)
  }
}
