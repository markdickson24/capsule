import ExpoModulesCore
import AVFoundation

public class ExpoVideoStitcherModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ExpoVideoStitcher")

    // Concatenates an ordered array of video URIs into one MP4.
    // Uses AVMutableComposition + AVMutableVideoComposition + AVAssetExportSession.
    AsyncFunction("stitchVideos") { (uris: [String], promise: Promise) in
      Task {
        do {
          let outputUri = try await ExpoVideoStitcherModule.stitch(uris: uris)
          promise.resolve(["uri": outputUri])
        } catch {
          promise.reject("STITCH_FAILED", error.localizedDescription)
        }
      }
    }

    // Trims a video to its first `maxSeconds` seconds, writing a NEW temp
    // file (the source is never modified). Resolves { uri } like stitchVideos.
    AsyncFunction("trimVideo") { (uri: String, maxSeconds: Double, promise: Promise) in
      Task {
        do {
          let outputUri = try await ExpoVideoStitcherModule.trim(uri: uri, maxSeconds: maxSeconds)
          promise.resolve(["uri": outputUri])
        } catch {
          promise.reject("TRIM_FAILED", error.localizedDescription)
        }
      }
    }

    // Displayed (post-rotation) size and duration, for the JS-side decision of
    // whether a video needs re-encoding before upload (src/lib/videoCompression.ts).
    AsyncFunction("probeVideo") { (uri: String, promise: Promise) in
      Task {
        do {
          promise.resolve(try await ExpoVideoStitcherModule.probe(uri: uri))
        } catch {
          promise.reject("PROBE_FAILED", error.localizedDescription)
        }
      }
    }

    // Re-encodes to H.264/AAC MP4 with the long side capped at `maxDimension`,
    // at most 30fps, at `videoBitrate`. Writes a NEW temp file. Resolves { uri }.
    AsyncFunction("compressVideo") { (uri: String, maxDimension: Double, videoBitrate: Double, promise: Promise) in
      Task {
        do {
          let outputUri = try await ExpoVideoStitcherModule.compress(
            uri: uri,
            maxDimension: CGFloat(maxDimension),
            videoBitrate: Int(videoBitrate)
          )
          promise.resolve(["uri": outputUri])
        } catch {
          promise.reject("COMPRESS_FAILED", error.localizedDescription)
        }
      }
    }
  }

  // Accept both "file:///..." and bare "/var/..." paths, same as stitch()/trim().
  private static func fileURL(_ uri: String) throws -> URL {
    if uri.hasPrefix("file://") {
      guard let u = URL(string: uri) else {
        throw NSError(
          domain: "ExpoVideoStitcher",
          code: 3,
          userInfo: [NSLocalizedDescriptionKey: "Invalid source URI"]
        )
      }
      return u
    }
    return URL(fileURLWithPath: uri)
  }

  // MARK: — Probe

  static func probe(uri: String) async throws -> [String: Double] {
    let asset = AVURLAsset(url: try fileURL(uri))
    let duration = try await asset.load(.duration)
    var width: CGFloat = 0
    var height: CGFloat = 0
    if let track = try await asset.loadTracks(withMediaType: .video).first {
      let naturalSize = try await track.load(.naturalSize)
      let transform = try await track.load(.preferredTransform)
      let displayed = CGRect(origin: .zero, size: naturalSize).applying(transform)
      width = abs(displayed.width)
      height = abs(displayed.height)
    }
    return [
      "width": Double(width),
      "height": Double(height),
      "durationSec": CMTimeGetSeconds(duration),
    ]
  }

  // MARK: — Compression

  // AVAssetExportSession presets can't take a bitrate (a 1080p preset still
  // runs ~10–20 Mbps), so this drives AVAssetReader → AVAssetWriter directly.
  // Frames are read through the asset's own video composition, which applies
  // preferredTransform (output is upright, no rotation metadata needed) and,
  // with Rec.709 color properties set, tone-maps iPhone HDR (HLG) to SDR —
  // reading HLG straight into 8-bit would look washed out. The writer input
  // does the downscale to the target size.
  static func compress(uri: String, maxDimension: CGFloat, videoBitrate: Int) async throws -> String {
    let asset = AVURLAsset(url: try fileURL(uri))
    guard let videoTrack = try await asset.loadTracks(withMediaType: .video).first else {
      throw NSError(
        domain: "ExpoVideoStitcher",
        code: 6,
        userInfo: [NSLocalizedDescriptionKey: "No video track"]
      )
    }
    let audioTrack = try await asset.loadTracks(withMediaType: .audio).first

    let naturalSize = try await videoTrack.load(.naturalSize)
    let transform = try await videoTrack.load(.preferredTransform)
    let displayed = CGRect(origin: .zero, size: naturalSize).applying(transform)
    let srcWidth = abs(displayed.width)
    let srcHeight = abs(displayed.height)
    let scale = min(1, maxDimension / max(srcWidth, srcHeight))
    // H.264 needs even dimensions.
    let outWidth = max(2, Int((srcWidth * scale / 2).rounded()) * 2)
    let outHeight = max(2, Int((srcHeight * scale / 2).rounded()) * 2)

    let rec709: [String: Any] = [
      AVVideoColorPrimariesKey: AVVideoColorPrimaries_ITU_R_709_2,
      AVVideoTransferFunctionKey: AVVideoTransferFunction_ITU_R_709_2,
      AVVideoYCbCrMatrixKey: AVVideoYCbCrMatrix_ITU_R_709_2,
    ]

    let videoComposition = AVMutableVideoComposition(propertiesOf: asset)
    videoComposition.colorPrimaries = AVVideoColorPrimaries_ITU_R_709_2
    videoComposition.colorTransferFunction = AVVideoTransferFunction_ITU_R_709_2
    videoComposition.colorYCbCrMatrix = AVVideoYCbCrMatrix_ITU_R_709_2
    // Cap at 30fps: 60fps sources spend half the bit budget on frames a phone
    // grid/viewer gains little from.
    let thirtyFps = CMTime(value: 1, timescale: 30)
    if CMTimeCompare(videoComposition.frameDuration, thirtyFps) < 0 {
      videoComposition.frameDuration = thirtyFps
    }

    let reader = try AVAssetReader(asset: asset)
    let videoOutput = AVAssetReaderVideoCompositionOutput(
      videoTracks: [videoTrack],
      videoSettings: [
        kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange,
      ]
    )
    videoOutput.videoComposition = videoComposition
    videoOutput.alwaysCopiesSampleData = false
    guard reader.canAdd(videoOutput) else {
      throw NSError(
        domain: "ExpoVideoStitcher",
        code: 7,
        userInfo: [NSLocalizedDescriptionKey: "Cannot read video track"]
      )
    }
    reader.add(videoOutput)

    var audioOutput: AVAssetReaderTrackOutput?
    if let audioTrack {
      let output = AVAssetReaderTrackOutput(
        track: audioTrack,
        outputSettings: [
          AVFormatIDKey: kAudioFormatLinearPCM,
          AVSampleRateKey: 44_100,
          AVNumberOfChannelsKey: 2,
        ]
      )
      output.alwaysCopiesSampleData = false
      if reader.canAdd(output) {
        reader.add(output)
        audioOutput = output
      }
    }

    let outputURL = FileManager.default.temporaryDirectory
      .appendingPathComponent(UUID().uuidString + ".mp4")
    let writer = try AVAssetWriter(outputURL: outputURL, fileType: .mp4)
    writer.shouldOptimizeForNetworkUse = true

    let videoInput = AVAssetWriterInput(
      mediaType: .video,
      outputSettings: [
        AVVideoCodecKey: AVVideoCodecType.h264,
        AVVideoWidthKey: outWidth,
        AVVideoHeightKey: outHeight,
        AVVideoScalingModeKey: AVVideoScalingModeResizeAspectFill,
        AVVideoColorPropertiesKey: rec709,
        AVVideoCompressionPropertiesKey: [
          AVVideoAverageBitRateKey: videoBitrate,
          AVVideoProfileLevelKey: AVVideoProfileLevelH264HighAutoLevel,
          AVVideoExpectedSourceFrameRateKey: 30,
        ],
      ]
    )
    videoInput.expectsMediaDataInRealTime = false
    writer.add(videoInput)

    var audioInput: AVAssetWriterInput?
    if audioOutput != nil {
      let input = AVAssetWriterInput(
        mediaType: .audio,
        outputSettings: [
          AVFormatIDKey: kAudioFormatMPEG4AAC,
          AVSampleRateKey: 44_100,
          AVNumberOfChannelsKey: 2,
          AVEncoderBitRateKey: 128_000,
        ]
      )
      input.expectsMediaDataInRealTime = false
      writer.add(input)
      audioInput = input
    }

    guard reader.startReading() else {
      throw reader.error ?? NSError(
        domain: "ExpoVideoStitcher",
        code: 8,
        userInfo: [NSLocalizedDescriptionKey: "Reader failed to start"]
      )
    }
    guard writer.startWriting() else {
      reader.cancelReading()
      throw writer.error ?? NSError(
        domain: "ExpoVideoStitcher",
        code: 9,
        userInfo: [NSLocalizedDescriptionKey: "Writer failed to start"]
      )
    }
    writer.startSession(atSourceTime: .zero)

    // Pump each track on its own queue until its reader output runs dry.
    await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
      let group = DispatchGroup()
      pump(output: videoOutput, into: videoInput, writer: writer, group: group, label: "compress.video")
      if let audioOutput, let audioInput {
        pump(output: audioOutput, into: audioInput, writer: writer, group: group, label: "compress.audio")
      }
      group.notify(queue: .global()) { continuation.resume() }
    }

    if reader.status == .failed || writer.status == .failed {
      let error = writer.error ?? reader.error
      writer.cancelWriting()
      try? FileManager.default.removeItem(at: outputURL)
      throw NSError(
        domain: "ExpoVideoStitcher",
        code: 10,
        userInfo: [NSLocalizedDescriptionKey: "Compress failed: \(error?.localizedDescription ?? "unknown")"]
      )
    }

    await writer.finishWriting()
    guard writer.status == .completed else {
      try? FileManager.default.removeItem(at: outputURL)
      throw NSError(
        domain: "ExpoVideoStitcher",
        code: 11,
        userInfo: [NSLocalizedDescriptionKey: "Compress failed: \(writer.error?.localizedDescription ?? "status \(writer.status.rawValue)")"]
      )
    }
    return outputURL.absoluteString
  }

  private static func pump(
    output: AVAssetReaderOutput,
    into input: AVAssetWriterInput,
    writer: AVAssetWriter,
    group: DispatchGroup,
    label: String
  ) {
    group.enter()
    var finished = false
    input.requestMediaDataWhenReady(on: DispatchQueue(label: label)) {
      guard !finished else { return }
      while input.isReadyForMoreMediaData {
        // nil = end of stream (or reader failure); append false = writer failure.
        guard let buffer = output.copyNextSampleBuffer(), input.append(buffer) else {
          finished = true
          // markAsFinished raises on a writer that has already failed.
          if writer.status == .writing { input.markAsFinished() }
          group.leave()
          return
        }
      }
    }
  }

  // MARK: — Stitching

  static func stitch(uris: [String]) async throws -> String {
    let composition = AVMutableComposition()
    guard
      let videoTrack = composition.addMutableTrack(
        withMediaType: .video,
        preferredTrackID: kCMPersistentTrackID_Invalid
      ),
      let audioTrack = composition.addMutableTrack(
        withMediaType: .audio,
        preferredTrackID: kCMPersistentTrackID_Invalid
      )
    else {
      throw NSError(
        domain: "ExpoVideoStitcher",
        code: 0,
        userInfo: [NSLocalizedDescriptionKey: "Could not create composition tracks"]
      )
    }

    // A plain AVMutableComposition has exactly one preferredTransform for its
    // whole video track's timeline — it can't represent different segments
    // having different orientations. Front and back camera segments (this
    // stitcher's main use case, the mid-recording camera flip) commonly DO
    // have different AVAssetTrack.preferredTransforms, so we build an explicit
    // AVMutableVideoComposition with one instruction per segment, each
    // supplying that segment's own corrected transform.
    var instructions: [AVMutableVideoCompositionInstruction] = []
    var targetSize: CGSize?
    var maxFrameRate: Float = 30

    var cursor = CMTime.zero

    for uriString in uris {
      // Accept both "file:///..." and bare "/var/..." paths.
      let url: URL
      if uriString.hasPrefix("file://") {
        guard let u = URL(string: uriString) else { continue }
        url = u
      } else {
        url = URL(fileURLWithPath: uriString)
      }

      let asset = AVURLAsset(url: url)

      let videoTracks = try await asset.loadTracks(withMediaType: .video)
      let audioTracks = try await asset.loadTracks(withMediaType: .audio)
      let duration = try await asset.load(.duration)
      let range = CMTimeRange(start: .zero, duration: duration)

      if let src = videoTracks.first {
        try videoTrack.insertTimeRange(range, of: src, at: cursor)

        let srcTransform = try await src.load(.preferredTransform)
        let srcNaturalSize = try await src.load(.naturalSize)
        let srcFrameRate = try await src.load(.nominalFrameRate)
        if srcFrameRate > maxFrameRate { maxFrameRate = srcFrameRate }

        // CGRect.applying already returns the correctly-normalized (positive
        // width/height, properly positioned) bounding box of the transformed
        // rect — no need to hand-roll corner math.
        let displayedRect = CGRect(origin: .zero, size: srcNaturalSize).applying(srcTransform)

        // First segment's displayed size becomes the shared render canvas —
        // avoids rescaling it, and keeps behavior identical to today for the
        // (still common) case where every segment shares the same
        // orientation/size. Later segments are fit into this canvas.
        let canvas = targetSize ?? displayedRect.size
        if targetSize == nil { targetSize = canvas }

        let instruction = AVMutableVideoCompositionInstruction()
        instruction.timeRange = CMTimeRange(start: cursor, duration: duration)
        let layerInstruction = AVMutableVideoCompositionLayerInstruction(assetTrack: videoTrack)
        layerInstruction.setTransform(
          ExpoVideoStitcherModule.correctedTransform(
            preferredTransform: srcTransform,
            displayedRect: displayedRect,
            canvas: canvas
          ),
          at: cursor
        )
        instruction.layerInstructions = [layerInstruction]
        instructions.append(instruction)
      }
      if let src = audioTracks.first {
        try audioTrack.insertTimeRange(range, of: src, at: cursor)
      }

      cursor = CMTimeAdd(cursor, duration)
    }

    let videoComposition = AVMutableVideoComposition()
    videoComposition.instructions = instructions
    videoComposition.renderSize = targetSize ?? CGSize(width: 1080, height: 1920)
    videoComposition.frameDuration = CMTime(value: 1, timescale: CMTimeScale(maxFrameRate.rounded()))

    // Export to a temp MP4 in the app's caches directory.
    let tmpDir = FileManager.default.temporaryDirectory
    let outputURL = tmpDir.appendingPathComponent(UUID().uuidString + ".mp4")

    guard let session = AVAssetExportSession(
      asset: composition,
      presetName: AVAssetExportPresetHighestQuality
    ) else {
      throw NSError(
        domain: "ExpoVideoStitcher",
        code: 1,
        userInfo: [NSLocalizedDescriptionKey: "Could not create export session"]
      )
    }

    session.outputURL = outputURL
    session.outputFileType = .mp4
    session.videoComposition = videoComposition

    await session.export()

    guard session.status == .completed else {
      let msg = session.error?.localizedDescription ?? "status \(session.status.rawValue)"
      throw NSError(
        domain: "ExpoVideoStitcher",
        code: 2,
        userInfo: [NSLocalizedDescriptionKey: "Export failed: \(msg)"]
      )
    }

    return outputURL.absoluteString
  }

  // MARK: — Trimming

  // Trims the source at `uri` to its first `maxSeconds` seconds and writes a
  // NEW temp MP4 (the source file is untouched). Uses AVAssetExportSession
  // with an explicit timeRange so the result duration is always <= maxSeconds
  // (clamped to the source's actual duration when it's already shorter).
  static func trim(uri: String, maxSeconds: Double) async throws -> String {
    // Accept both "file:///..." and bare "/var/..." paths, same as stitch().
    let url: URL
    if uri.hasPrefix("file://") {
      guard let u = URL(string: uri) else {
        throw NSError(
          domain: "ExpoVideoStitcher",
          code: 3,
          userInfo: [NSLocalizedDescriptionKey: "Invalid source URI"]
        )
      }
      url = u
    } else {
      url = URL(fileURLWithPath: uri)
    }

    let asset = AVURLAsset(url: url)
    let assetDuration = try await asset.load(.duration)
    let assetDurationSeconds = CMTimeGetSeconds(assetDuration)

    let clampedSeconds = min(maxSeconds, assetDurationSeconds)
    let timeRange = CMTimeRange(
      start: .zero,
      duration: CMTime(seconds: clampedSeconds, preferredTimescale: 600)
    )

    // Export to a temp MP4 in the app's caches directory — mirrors stitch()'s
    // temp-file convention (new UUID-named file, original source untouched).
    let tmpDir = FileManager.default.temporaryDirectory
    let outputURL = tmpDir.appendingPathComponent(UUID().uuidString + ".mp4")

    // A quality preset re-encodes to the exact requested timeRange (passthrough
    // can overshoot to the nearest keyframe), so this is what guarantees the
    // result is <= maxSeconds rather than merely close to it.
    guard let session = AVAssetExportSession(
      asset: asset,
      presetName: AVAssetExportPresetHighestQuality
    ) else {
      throw NSError(
        domain: "ExpoVideoStitcher",
        code: 4,
        userInfo: [NSLocalizedDescriptionKey: "Could not create export session"]
      )
    }

    session.outputURL = outputURL
    session.outputFileType = .mp4
    session.timeRange = timeRange

    await session.export()

    guard session.status == .completed else {
      let msg = session.error?.localizedDescription ?? "status \(session.status.rawValue)"
      throw NSError(
        domain: "ExpoVideoStitcher",
        code: 5,
        userInfo: [NSLocalizedDescriptionKey: "Trim failed: \(msg)"]
      )
    }

    return outputURL.absoluteString
  }

  // MARK: — Transform helpers

  // Maps a segment from raw sensor/buffer space into its correct place on
  // the shared render canvas: apply the segment's own preferredTransform
  // (fixes rotation/mirroring — the actual bug), re-anchor at (0,0) in case
  // that left a non-zero origin (mirrored transforms can), then uniformly
  // scale+center to fit the canvas — this also protects against front/back
  // cameras recording at slightly different native resolutions, not just
  // different rotations.
  private static func correctedTransform(
    preferredTransform: CGAffineTransform,
    displayedRect: CGRect,
    canvas: CGSize
  ) -> CGAffineTransform {
    guard displayedRect.width > 0, displayedRect.height > 0 else { return preferredTransform }

    let anchor = CGAffineTransform(translationX: -displayedRect.origin.x, y: -displayedRect.origin.y)
    let scale = min(canvas.width / displayedRect.width, canvas.height / displayedRect.height)
    let scaledSize = CGSize(width: displayedRect.width * scale, height: displayedRect.height * scale)
    let center = CGAffineTransform(
      translationX: (canvas.width - scaledSize.width) / 2,
      y: (canvas.height - scaledSize.height) / 2
    )

    return preferredTransform
      .concatenating(anchor)
      .concatenating(CGAffineTransform(scaleX: scale, y: scale))
      .concatenating(center)
  }
}
