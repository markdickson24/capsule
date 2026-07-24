import ActivityKit
import SwiftUI
import WidgetKit

// Hex -> Color. The activity carries the viewer's accent color as a hex
// string, so the card matches the app they themed.
//
// Deliberately NOT named `accentColor` — `View` has a deprecated instance
// method `accentColor(_ accentColor: Color?) -> some View`, and inside any
// type conforming to `View`, Swift's unqualified name lookup finds that
// member first and stops looking, even though it doesn't type-check for a
// `String` argument. That shadowing silently breaks this helper at every
// call site inside a `View` body. Keep this name (or another that can't
// collide with `View`/`Widget`/`WidgetConfiguration` members) — don't rename
// it back to `accentColor`.
@available(iOS 16.2, *)
private func colorFromHex(_ hex: String) -> Color {
  var s = hex.trimmingCharacters(in: .whitespacesAndNewlines)
  if s.hasPrefix("#") { s.removeFirst() }
  guard s.count == 6, let v = UInt32(s, radix: 16) else {
    return Color(red: 0.99, green: 0.42, blue: 0.36) // brand #FC6A5B fallback
  }
  return Color(
    red: Double((v >> 16) & 0xFF) / 255,
    green: Double((v >> 8) & 0xFF) / 255,
    blue: Double(v & 0xFF) / 255
  )
}

@available(iOS 16.2, *)
struct CapsuleLiveActivityView: View {
  let context: ActivityViewContext<CapsuleActivityAttributes>

  private var accent: Color { colorFromHex(context.attributes.accentHex) }
  private var deepLink: URL {
    URL(string: "capsule://capsule/\(context.attributes.capsuleId)")!
  }
  private var cameraLink: URL {
    URL(string: "capsule://capsule/\(context.attributes.capsuleId)/camera")!
  }

  var body: some View {
    HStack(alignment: .top, spacing: 12) {
      VStack(alignment: .leading, spacing: 6) {
        Text(context.attributes.title)
          .font(.headline)
          .foregroundStyle(.white)
          .lineLimit(2)

        // The system ticks this on-device with no updates from the app, which
        // is what lets the whole feature work with no server component.
        HStack(spacing: 4) {
          Image(systemName: "clock")
          Text(timerInterval: Date()...context.attributes.deadline, countsDown: true)
            .monospacedDigit()
        }
        .font(.subheadline)
        .foregroundStyle(.white.opacity(0.85))

        ProgressView(
          timerInterval: context.attributes.windowStart...context.attributes.deadline,
          countsDown: false
        ) {
          EmptyView()
        } currentValueLabel: {
          EmptyView()
        }
        .tint(accent)
        .labelsHidden()

        Text("\(context.state.photoCount) photo\(context.state.photoCount == 1 ? "" : "s") · \(context.state.memberCount) here")
          .font(.caption)
          .foregroundStyle(.white.opacity(0.6))
      }

      Spacer(minLength: 0)

      // Link (not Button/AppIntent) — the whole point is to open the camera in
      // the app, and Link needs no AppIntent target wiring.
      Link(destination: cameraLink) {
        Image(systemName: "camera.fill")
          .font(.system(size: 20, weight: .semibold))
          .foregroundStyle(.white)
          .frame(width: 52, height: 40)
          .background(accent, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
      }
    }
    .padding(16)
    .activityBackgroundTint(Color.black.opacity(0.55))
    .activitySystemActionForegroundColor(.white)
    .widgetURL(deepLink)
  }
}

@available(iOS 16.2, *)
struct CapsuleLiveActivity: Widget {
  var body: some WidgetConfiguration {
    ActivityConfiguration(for: CapsuleActivityAttributes.self) { context in
      CapsuleLiveActivityView(context: context)
    } dynamicIsland: { context in
      DynamicIsland {
        DynamicIslandExpandedRegion(.leading) {
          Image(systemName: "lock.fill")
            .foregroundStyle(colorFromHex(context.attributes.accentHex))
        }
        DynamicIslandExpandedRegion(.trailing) {
          Link(destination: URL(string: "capsule://capsule/\(context.attributes.capsuleId)/camera")!) {
            Image(systemName: "camera.fill")
              .foregroundStyle(colorFromHex(context.attributes.accentHex))
          }
        }
        DynamicIslandExpandedRegion(.center) {
          Text(context.attributes.title).font(.caption).lineLimit(1)
        }
        DynamicIslandExpandedRegion(.bottom) {
          ProgressView(
            timerInterval: context.attributes.windowStart...context.attributes.deadline,
            countsDown: false
          ) { EmptyView() } currentValueLabel: { EmptyView() }
          .tint(colorFromHex(context.attributes.accentHex))
          .labelsHidden()
        }
      } compactLeading: {
        Image(systemName: "lock.fill")
          .foregroundStyle(colorFromHex(context.attributes.accentHex))
      } compactTrailing: {
        Text(timerInterval: Date()...context.attributes.deadline, countsDown: true)
          .monospacedDigit()
          .frame(maxWidth: 44)
      } minimal: {
        Image(systemName: "lock.fill")
          .foregroundStyle(colorFromHex(context.attributes.accentHex))
      }
      .widgetURL(URL(string: "capsule://capsule/\(context.attributes.capsuleId)")!)
    }
  }
}

@main
struct CapsuleLiveActivityBundle: WidgetBundle {
  var body: some Widget {
    if #available(iOS 16.2, *) {
      CapsuleLiveActivity()
    }
  }
}
