import ActivityKit
import Foundation

// SHARED TYPE — compiled into BOTH the app target (via
// ExpoLiveActivity.podspec) and the CapsuleLiveActivity widget extension
// (via targets/liveactivity/CapsuleActivityAttributes.swift, a symlink to
// this file). ActivityKit matches activities by concrete type: two
// separately-declared but identical structs in different modules do NOT
// interoperate, so this must stay a single source of truth.
@available(iOS 16.2, *)
public struct CapsuleActivityAttributes: ActivityAttributes {
  // Static — fixed for the activity's whole lifetime.
  public let capsuleId: String
  public let title: String
  /// The VIEWING member's own accent color (users.accent_color), not the
  /// owner's — it renders on their lock screen, and accent color is a
  /// per-user preference in this app.
  public let accentHex: String
  /// Lower bound of the progress bar.
  public let windowStart: Date
  /// What the countdown counts down to.
  public let deadline: Date

  public struct ContentState: Codable, Hashable {
    public var photoCount: Int
    public var memberCount: Int

    public init(photoCount: Int, memberCount: Int) {
      self.photoCount = photoCount
      self.memberCount = memberCount
    }
  }

  public init(capsuleId: String, title: String, accentHex: String, windowStart: Date, deadline: Date) {
    self.capsuleId = capsuleId
    self.title = title
    self.accentHex = accentHex
    self.windowStart = windowStart
    self.deadline = deadline
  }
}
