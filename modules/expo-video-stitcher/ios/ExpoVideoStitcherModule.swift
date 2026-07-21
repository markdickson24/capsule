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
