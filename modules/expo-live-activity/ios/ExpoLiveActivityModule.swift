import ActivityKit
import ExpoModulesCore

struct LiveActivityStartConfig: Record {
  @Field var capsuleId: String = ""
  @Field var title: String = ""
  @Field var accentHex: String = "#FC6A5B"
  /// Epoch milliseconds — JS Date.getTime(), avoiding ISO-string parsing on
  /// the Swift side entirely.
  @Field var windowStartMs: Double = 0
  @Field var deadlineMs: Double = 0
  @Field var photoCount: Int = 0
  @Field var memberCount: Int = 0
}

public class ExpoLiveActivityModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ExpoLiveActivity")

    // Both an OS-version check and the user's own system-wide setting. Callers
    // hide all UI when this is false, so no dead toggles.
    Function("isSupported") { () -> Bool in
      if #available(iOS 16.2, *) {
        return ActivityAuthorizationInfo().areActivitiesEnabled
      }
      return false
    }

    AsyncFunction("start") { (config: LiveActivityStartConfig) -> String? in
      guard #available(iOS 16.2, *) else { return nil }
      guard ActivityAuthorizationInfo().areActivitiesEnabled else { return nil }

      // Never run two activities for the same capsule.
      if let existing = Self.findActivity(capsuleId: config.capsuleId) {
        return existing.id
      }

      let deadline = Date(timeIntervalSince1970: config.deadlineMs / 1000)
      let attributes = CapsuleActivityAttributes(
        capsuleId: config.capsuleId,
        title: config.title,
        accentHex: config.accentHex,
        windowStart: Date(timeIntervalSince1970: config.windowStartMs / 1000),
        deadline: deadline
      )
      let state = CapsuleActivityAttributes.ContentState(
        photoCount: config.photoCount,
        memberCount: config.memberCount
      )

      // staleDate = the deadline: iOS marks the activity stale and dismisses
      // it on its own, so a device that never opens the app again still ends
      // up clean. This is what makes the no-server design work.
      let content = ActivityContent(state: state, staleDate: deadline)

      let activity = try Activity.request(
        attributes: attributes,
        content: content,
        pushType: nil // no push-to-start; see the spec's non-goals
      )
      return activity.id
    }

    AsyncFunction("update") { (capsuleId: String, photoCount: Int, memberCount: Int) in
      guard #available(iOS 16.2, *) else { return }
      guard let activity = Self.findActivity(capsuleId: capsuleId) else { return }

      let state = CapsuleActivityAttributes.ContentState(
        photoCount: photoCount,
        memberCount: memberCount
      )
      await activity.update(
        ActivityContent(state: state, staleDate: activity.attributes.deadline)
      )
    }

    AsyncFunction("end") { (capsuleId: String, immediate: Bool) in
      guard #available(iOS 16.2, *) else { return }
      guard let activity = Self.findActivity(capsuleId: capsuleId) else { return }
      await activity.end(nil, dismissalPolicy: immediate ? .immediate : .default)
    }

    // Truth for "what's running" — read from the OS, never mirrored in JS,
    // because iOS can dismiss an activity without telling the app.
    AsyncFunction("listActive") { () -> [String] in
      guard #available(iOS 16.2, *) else { return [] }
      return Activity<CapsuleActivityAttributes>.activities.map { $0.attributes.capsuleId }
    }
  }

  @available(iOS 16.2, *)
  private static func findActivity(capsuleId: String) -> Activity<CapsuleActivityAttributes>? {
    Activity<CapsuleActivityAttributes>.activities.first { $0.attributes.capsuleId == capsuleId }
  }
}
