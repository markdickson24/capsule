import ExpoModulesCore
import AVFoundation

public class ExpoVideoStitcherModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ExpoVideoStitcher")

    // Concatenates an ordered array of video URIs into one MP4.
    // Uses AVMutableComposition + AVAssetExportSession.
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
      }
      if let src = audioTracks.first {
        try audioTrack.insertTimeRange(range, of: src, at: cursor)
      }

      cursor = CMTimeAdd(cursor, duration)
    }

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
}
