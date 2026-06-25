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

  // Shared blurred backdrop behind the two side-by-side feeds (sideBySide only).
  // Fed by the back lens's data-output frames (already running), throttled.
  private let backdropLayer = CALayer()
  private var lastBackdropAt: CFTimeInterval = 0

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
  private var captureSeq = 0
  private var pendingCaptureId = 0
  private let captureLock = NSLock()
  private let ciContext = CIContext(options: nil)

  // MARK: - Video Recording
  private var assetWriter: AVAssetWriter?
  private var videoWriterInput: AVAssetWriterInput?
  private var pixelBufferAdaptor: AVAssetWriterInputPixelBufferAdaptor?
  private var audioWriterInput: AVAssetWriterInput?
  private let audioOutput = AVCaptureAudioDataOutput()
  private var audioGrabber: AudioGrabber?
  private var isRecording = false
  private var recordingStartTime: CMTime = .zero
  private var needsRecordingStartTime = false
  private var recordingPromise: Promise?
  private var latestBackBuffer: CMSampleBuffer?
  private var latestFrontBuffer: CMSampleBuffer?
  private var recordingMaxTimer: DispatchWorkItem?
  private let recordingLock = NSLock()

  let onInitError = EventDispatcher()

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    backgroundColor = .black
    backPreviewLayer.videoGravity = .resizeAspectFill
    frontPreviewLayer.videoGravity = .resizeAspectFill
    // Snapchat-style split: a single blurred backdrop (driven by the back lens)
    // sits behind the two aspect-fit feeds so the letterbox gaps aren't black.
    backdropLayer.contentsGravity = .resizeAspectFill
    backdropLayer.masksToBounds = true
    backPreviewLayer.backgroundColor = UIColor.clear.cgColor
    frontPreviewLayer.backgroundColor = UIColor.clear.cgColor
    layer.addSublayer(backdropLayer)
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
    backdropLayer.frame = bounds
    backdropLayer.isHidden = layout != .sideBySide
    switch layout {
    case .sideBySide:
      // Reset any PiP styling on the front layer.
      frontPreviewLayer.cornerRadius = 0
      frontPreviewLayer.borderWidth = 0
      frontPreviewLayer.masksToBounds = false
      // Show each feed whole (aspect-fit); the blurred backdrop fills the gaps.
      backPreviewLayer.videoGravity = .resizeAspect
      frontPreviewLayer.videoGravity = .resizeAspect
      let half = bounds.width / 2
      backPreviewLayer.frame = CGRect(x: 0, y: 0, width: half, height: bounds.height)
      frontPreviewLayer.frame = CGRect(x: half, y: 0, width: half, height: bounds.height)
    case .pip:
      // Full-frame back + filled front bubble.
      backPreviewLayer.videoGravity = .resizeAspectFill
      frontPreviewLayer.videoGravity = .resizeAspectFill
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

    // Audio input for video recording. Uses standard addInput (not addInputWithNoConnections)
    // because audio has no position conflict in multi-cam sessions.
    if let audioDevice = AVCaptureDevice.default(for: .audio),
       let audioIn = try? AVCaptureDeviceInput(device: audioDevice),
       session.canAddInput(audioIn) {
      session.addInput(audioIn)
      audioGrabber = AudioGrabber { [weak self] buf in self?.onAudioFrame(buf) }
      audioOutput.setSampleBufferDelegate(audioGrabber!, queue: dataQueue)
      if session.canAddOutput(audioOutput) {
        session.addOutput(audioOutput)
      }
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

    // Multi-cam preview layers must be associated with the session *without* an
    // automatic connection before a manual AVCaptureConnection can be added —
    // otherwise canAddConnection returns false even though hardware cost is fine
    // (this is what produced the "cost 0.09" failure: structural, not budget).
    previewLayer.setSessionWithNoConnection(session)

    // Live preview connection (GPU-cheap).
    let previewConn = AVCaptureConnection(inputPort: port, videoPreviewLayer: previewLayer)
    guard ensureCanAdd(previewConn) else {
      emitInitError("Couldn't attach the \(position == .back ? "back" : "front") preview (cost \(String(format: "%.2f", session.hardwareCost)))")
      return false
    }
    session.addConnection(previewConn)
    if previewConn.isVideoOrientationSupported {
      previewConn.videoOrientation = .portrait
    }
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
      self.captureSeq += 1
      let myId = self.captureSeq
      self.pendingCaptureId = myId
      self.pendingPromise = promise
      self.pendingBack = nil
      self.pendingFront = nil
      self.captureLock.unlock()

      // Safety: if frames never arrive, don't leave the JS promise hanging. Match on
      // the capture id (Promise is a value type, so identity compare isn't possible)
      // so a finished capture's stale timeout can't cancel a *later* capture.
      self.sessionQueue.asyncAfter(deadline: .now() + 2.0) { [weak self] in
        guard let self = self else { return }
        self.captureLock.lock()
        let isThisCapture = self.pendingCaptureId == myId && self.pendingPromise != nil
        let stale = isThisCapture ? self.pendingPromise : nil
        if isThisCapture {
          self.pendingPromise = nil
          self.pendingBack = nil
          self.pendingFront = nil
        }
        self.captureLock.unlock()
        stale?.reject("ERR_TIMEOUT", "Dual capture timed out waiting for frames")
      }
    }
  }

  /// Called for every delivered frame. Drives video recording when active, then
  /// the blurred backdrop (suppressed during recording to free CPU), then still capture.
  private func onFrame(_ sampleBuffer: CMSampleBuffer, isBack: Bool) {
    // Video recording path — composite frames in real-time.
    handleRecordingFrame(sampleBuffer, isBack: isBack)

    // Backdrop suppressed during recording to free CPU for compositing.
    if isBack && layout == .sideBySide && !isRecording {
      updateBackdrop(sampleBuffer)
    }

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

  /// Render a cheap, heavily-blurred thumbnail of the back lens into `backdropLayer`.
  /// Throttled to ~14fps and downscaled to ~96px before blurring so it stays well
  /// within the multi-cam hardware budget. Runs on `dataQueue` (the delegate queue).
  private func updateBackdrop(_ sampleBuffer: CMSampleBuffer) {
    let now = CACurrentMediaTime()
    if now - lastBackdropAt < 0.07 { return }
    lastBackdropAt = now

    guard let pixelBuffer = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }
    let ci = CIImage(cvPixelBuffer: pixelBuffer)
    guard ci.extent.width > 0 else { return }

    let scale = 96.0 / ci.extent.width
    let small = ci.transformed(by: CGAffineTransform(scaleX: scale, y: scale))
    guard let filter = CIFilter(name: "CIGaussianBlur") else { return }
    filter.setValue(small.clampedToExtent(), forKey: kCIInputImageKey)
    filter.setValue(8.0, forKey: kCIInputRadiusKey)
    guard let output = filter.outputImage,
          let cg = ciContext.createCGImage(output, from: small.extent) else { return }

    DispatchQueue.main.async { [weak self] in
      CATransaction.begin()
      CATransaction.setDisableActions(true)
      self?.backdropLayer.contents = cg
      CATransaction.commit()
    }
  }

  private func finishCapture(back: UIImage, front: UIImage, promise: Promise) {
    let merged: UIImage?
    // For PiP we also render the swapped composite (front as the full frame, back as
    // the bubble) so the viewer can offer a BeReal-style tap-to-swap. sideBySide has
    // no meaningful swap, so it stays single.
    var altMerged: UIImage? = nil
    switch layout {
    case .sideBySide:
      merged = ExpoDualCameraView.composeSideBySide(left: back, right: front)
    case .pip:
      merged = ExpoDualCameraView.composePiP(base: back, inset: front)
      altMerged = ExpoDualCameraView.composePiP(base: front, inset: back)
    }

    guard let composite = merged,
          let data = composite.jpegData(compressionQuality: 0.9) else {
      promise.reject("ERR_COMPOSITE", "Failed to composite the dual photo")
      return
    }

    func write(_ image: UIImage) -> URL? {
      guard let d = image.jpegData(compressionQuality: 0.9) else { return nil }
      let u = FileManager.default.temporaryDirectory
        .appendingPathComponent("dual-\(UUID().uuidString).jpg")
      return (try? d.write(to: u)) == nil ? nil : u
    }

    let url = FileManager.default.temporaryDirectory
      .appendingPathComponent("dual-\(UUID().uuidString).jpg")
    do {
      try data.write(to: url)
      var result: [String: Any] = [
        "uri": url.absoluteString,
        "width": composite.size.width,
        "height": composite.size.height,
      ]
      // Swapped variant (PiP only). Absent ⇒ not a swappable dual photo.
      if let alt = altMerged, let altUrl = write(alt) {
        result["altUri"] = altUrl.absoluteString
      }
      promise.resolve(result)
    } catch {
      promise.reject("ERR_WRITE", "Failed to write the dual photo: \(error.localizedDescription)")
    }
  }

  /// Snapchat-style split: a single blurred backdrop (from the back lens) fills the
  /// whole frame, and each lens is drawn WHOLE (aspect-fit, never cropped) centered
  /// in its half, so the letterbox gaps reveal the soft backdrop instead of black.
  /// No divider. `left` is the back lens, `right` the front lens — matching the
  /// side-by-side preview arrangement.
  static func composeSideBySide(left: UIImage, right: UIImage) -> UIImage? {
    let canvas = left.size
    guard canvas.width > 0, canvas.height > 0 else { return nil }
    let halfW = (canvas.width / 2).rounded()
    let backdrop = blurredImage(left, radius: canvas.width * 0.04)

    let format = UIGraphicsImageRendererFormat.default()
    format.scale = 1
    let renderer = UIGraphicsImageRenderer(size: canvas, format: format)
    return renderer.image { ctx in
      // Shared blurred backdrop (back lens) across the entire frame.
      drawAspectFill(backdrop ?? left, into: CGRect(origin: .zero, size: canvas), ctx: ctx.cgContext)
      // Each lens shown whole, centered in its half.
      drawAspectFit(left, into: CGRect(x: 0, y: 0, width: halfW, height: canvas.height), ctx: ctx.cgContext)
      drawAspectFit(right, into: CGRect(x: halfW, y: 0, width: canvas.width - halfW, height: canvas.height), ctx: ctx.cgContext)
    }
  }

  /// Draw `image` to cover `rect` (aspect-fill, center-cropped), clipped to `rect`.
  private static func drawAspectFill(_ image: UIImage, into rect: CGRect, ctx: CGContext) {
    ctx.saveGState()
    ctx.clip(to: rect)
    let scale = max(rect.width / image.size.width, rect.height / image.size.height)
    let drawW = image.size.width * scale
    let drawH = image.size.height * scale
    image.draw(in: CGRect(x: rect.midX - drawW / 2, y: rect.midY - drawH / 2, width: drawW, height: drawH))
    ctx.restoreGState()
  }

  /// Draw `image` to fit inside `rect` (aspect-fit, whole image, centered). No crop.
  private static func drawAspectFit(_ image: UIImage, into rect: CGRect, ctx: CGContext) {
    let scale = min(rect.width / image.size.width, rect.height / image.size.height)
    let drawW = image.size.width * scale
    let drawH = image.size.height * scale
    image.draw(in: CGRect(x: rect.midX - drawW / 2, y: rect.midY - drawH / 2, width: drawW, height: drawH))
  }

  /// Gaussian-blur `image` for use as a soft backdrop. Clamps to extent first so the
  /// blur doesn't darken/feather the edges, then crops back to the original size.
  private static func blurredImage(_ image: UIImage, radius: CGFloat) -> UIImage? {
    guard let cg = image.cgImage else { return nil }
    let ci = CIImage(cgImage: cg)
    guard let filter = CIFilter(name: "CIGaussianBlur") else { return nil }
    filter.setValue(ci.clampedToExtent(), forKey: kCIInputImageKey)
    filter.setValue(radius, forKey: kCIInputRadiusKey)
    guard let output = filter.outputImage else { return nil }
    let ctx = CIContext(options: nil)
    guard let result = ctx.createCGImage(output, from: ci.extent) else { return nil }
    return UIImage(cgImage: result)
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

  // MARK: - Recording implementation

  private func handleRecordingFrame(_ sampleBuffer: CMSampleBuffer, isBack: Bool) {
    recordingLock.lock()
    guard isRecording else { recordingLock.unlock(); return }
    if isBack { latestBackBuffer = sampleBuffer } else { latestFrontBuffer = sampleBuffer }
    let shouldWrite = isBack && latestFrontBuffer != nil
    let back = latestBackBuffer
    let front = latestFrontBuffer
    let needsStart = needsRecordingStartTime
    recordingLock.unlock()

    guard shouldWrite, let back = back, let front = front else { return }
    let pts = CMSampleBufferGetPresentationTimeStamp(back)

    if needsStart {
      recordingLock.lock()
      if needsRecordingStartTime {
        needsRecordingStartTime = false
        recordingStartTime = pts
        assetWriter?.startSession(atSourceTime: pts)
      }
      recordingLock.unlock()
    }

    writeVideoFrame(back: back, front: front, pts: pts)
  }

  private func writeVideoFrame(back: CMSampleBuffer, front: CMSampleBuffer, pts: CMTime) {
    recordingLock.lock()
    guard let adaptor = pixelBufferAdaptor,
          let videoIn = videoWriterInput,
          !needsRecordingStartTime else { recordingLock.unlock(); return }
    recordingLock.unlock()

    guard videoIn.isReadyForMoreMediaData else { return }
    guard let backImage = imageFromSampleBuffer(back),
          let frontImage = imageFromSampleBuffer(front) else { return }

    let composite: UIImage?
    switch layout {
    case .sideBySide: composite = ExpoDualCameraView.composeSideBySide(left: backImage, right: frontImage)
    case .pip:        composite = ExpoDualCameraView.composePiP(base: backImage, inset: frontImage)
    }
    guard let img = composite, let pb = pixelBufferFromImage(img) else { return }

    let relPTS = CMTimeSubtract(pts, recordingStartTime)
    adaptor.append(pb, withPresentationTime: relPTS)
  }

  private func pixelBufferFromImage(_ image: UIImage) -> CVPixelBuffer? {
    guard let cg = image.cgImage else { return nil }
    recordingLock.lock()
    let pool = pixelBufferAdaptor?.pixelBufferPool
    recordingLock.unlock()

    var pb: CVPixelBuffer?
    if let pool = pool {
      CVPixelBufferPoolCreatePixelBuffer(nil, pool, &pb)
    }
    if pb == nil {
      let attrs: [String: Any] = [kCVPixelBufferCGImageCompatibilityKey as String: true,
                                   kCVPixelBufferCGBitmapContextCompatibilityKey as String: true]
      CVPixelBufferCreate(kCFAllocatorDefault, Int(image.size.width), Int(image.size.height),
                          kCVPixelFormatType_32BGRA, attrs as CFDictionary, &pb)
    }
    guard let pb = pb else { return nil }
    CVPixelBufferLockBaseAddress(pb, [])
    defer { CVPixelBufferUnlockBaseAddress(pb, []) }
    let w = CVPixelBufferGetWidth(pb)
    let h = CVPixelBufferGetHeight(pb)
    guard let ctx = CGContext(
      data: CVPixelBufferGetBaseAddress(pb),
      width: w, height: h, bitsPerComponent: 8,
      bytesPerRow: CVPixelBufferGetBytesPerRow(pb),
      space: CGColorSpaceCreateDeviceRGB(),
      bitmapInfo: CGImageAlphaInfo.premultipliedFirst.rawValue | CGBitmapInfo.byteOrder32Little.rawValue
    ) else { return nil }
    ctx.draw(cg, in: CGRect(x: 0, y: 0, width: w, height: h))
    return pb
  }

  private func onAudioFrame(_ sampleBuffer: CMSampleBuffer) {
    recordingLock.lock()
    let recording = isRecording
    let needsStart = needsRecordingStartTime
    let audioIn = audioWriterInput
    recordingLock.unlock()
    guard recording, !needsStart, let audioIn = audioIn,
          audioIn.isReadyForMoreMediaData else { return }
    audioIn.append(sampleBuffer)
  }

  func startRecordingWithPromise(options: [String: Any]?, promise: Promise) {
    sessionQueue.async { [weak self] in
      guard let self = self, self.configured else {
        promise.reject("ERR_NOT_READY", "Dual camera session is not running")
        return
      }
      self.recordingLock.lock()
      guard !self.isRecording else {
        self.recordingLock.unlock()
        promise.reject("ERR_BUSY", "A recording is already in progress")
        return
      }
      let maxDuration = (options?["maxDuration"] as? Double) ?? 30.0
      let outputURL = FileManager.default.temporaryDirectory
        .appendingPathComponent("dual-video-\(UUID().uuidString).mp4")
      do {
        let writer = try AVAssetWriter(outputURL: outputURL, fileType: .mp4)
        let videoSettings: [String: Any] = [
          AVVideoCodecKey: AVVideoCodecType.h264,
          AVVideoWidthKey: 720,
          AVVideoHeightKey: 1280,
          AVVideoCompressionPropertiesKey: [AVVideoAverageBitRateKey: 8_000_000],
        ]
        let videoIn = AVAssetWriterInput(mediaType: .video, outputSettings: videoSettings)
        videoIn.expectsMediaDataInRealTime = true
        let adaptor = AVAssetWriterInputPixelBufferAdaptor(
          assetWriterInput: videoIn,
          sourcePixelBufferAttributes: [
            kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
            kCVPixelBufferWidthKey as String: 720,
            kCVPixelBufferHeightKey as String: 1280,
          ]
        )
        let audioSettings: [String: Any] = [
          AVFormatIDKey: kAudioFormatMPEG4AAC,
          AVSampleRateKey: 44100,
          AVNumberOfChannelsKey: 1,
          AVEncoderBitRateKey: 64000,
        ]
        let audioIn = AVAssetWriterInput(mediaType: .audio, outputSettings: audioSettings)
        audioIn.expectsMediaDataInRealTime = true

        guard writer.canAdd(videoIn), writer.canAdd(audioIn) else {
          self.recordingLock.unlock()
          promise.reject("ERR_SETUP", "Cannot configure video writer inputs")
          return
        }
        writer.add(videoIn)
        writer.add(audioIn)
        writer.startWriting()

        self.assetWriter = writer
        self.videoWriterInput = videoIn
        self.pixelBufferAdaptor = adaptor
        self.audioWriterInput = audioIn
        self.recordingPromise = promise
        self.needsRecordingStartTime = true
        self.isRecording = true
        self.recordingLock.unlock()

        let timer = DispatchWorkItem { [weak self] in self?.finalizeRecording() }
        self.recordingMaxTimer = timer
        self.sessionQueue.asyncAfter(deadline: .now() + maxDuration, execute: timer)
      } catch {
        self.recordingLock.unlock()
        promise.reject("ERR_SETUP", "Failed to create video writer: \(error.localizedDescription)")
      }
    }
  }

  func stopRecordingSync() {
    sessionQueue.async { [weak self] in self?.finalizeRecording() }
  }

  private func finalizeRecording() {
    recordingLock.lock()
    guard isRecording else { recordingLock.unlock(); return }
    isRecording = false
    recordingMaxTimer?.cancel()
    recordingMaxTimer = nil

    let writer = assetWriter
    let videoIn = videoWriterInput
    let audioIn = audioWriterInput
    let promise = recordingPromise

    assetWriter = nil
    videoWriterInput = nil
    pixelBufferAdaptor = nil
    audioWriterInput = nil
    recordingPromise = nil
    latestBackBuffer = nil
    latestFrontBuffer = nil
    recordingLock.unlock()

    videoIn?.markAsFinished()
    audioIn?.markAsFinished()

    writer?.finishWriting { [weak writer] in
      if writer?.status == .completed, let url = writer?.outputURL {
        promise?.resolve(["uri": url.absoluteString])
      } else {
        promise?.reject("ERR_RECORDING",
          "Recording failed: \(writer?.error?.localizedDescription ?? "unknown")")
      }
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

/// Forwards audio sample buffers to a closure for AVAssetWriter during recording.
private class AudioGrabber: NSObject, AVCaptureAudioDataOutputSampleBufferDelegate {
  private let onAudioFrame: (CMSampleBuffer) -> Void
  init(onAudioFrame: @escaping (CMSampleBuffer) -> Void) { self.onAudioFrame = onAudioFrame }

  func captureOutput(_ output: AVCaptureOutput,
                     didOutput sampleBuffer: CMSampleBuffer,
                     from connection: AVCaptureConnection) {
    onAudioFrame(sampleBuffer)
  }
}
