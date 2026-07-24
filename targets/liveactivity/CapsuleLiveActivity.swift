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
        //
        // Range must be windowStart...deadline, NOT Date()...deadline: Swift's
        // `...` preconditions lowerBound <= upperBound and TRAPS otherwise.
        // ActivityKit re-invokes this view at exactly staleDate == deadline,
        // the moment Date() >= deadline — so a live `Date()` lower bound
        // crashes the widget extension at the end of every window, the most
        // visible moment the feature has. windowStart < deadline is guaranteed
        // by desiredActivities (only starts when windowStart <= now < deadline),
        // and a past lower bound is the Apple-sanctioned pattern: countsDown
        // counts down to upperBound regardless of where the interval began.
        HStack(spacing: 4) {
          Image(systemName: "clock")
          Text(timerInterval: context.attributes.windowStart...context.attributes.deadline, countsDown: true)
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
      .accessibilityLabel("Add a photo")
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
          // Leading/trailing regions sit either side of the camera notch and
          // are narrow — an icon plus one short word is the practical ceiling.
          Label {
            Text("Sealed").font(.caption2)
          } icon: {
            Image(systemName: "lock.fill")
          }
          .foregroundStyle(colorFromHex(context.attributes.accentHex))
          .accessibilityLabel("Capsule locked")
        }
        DynamicIslandExpandedRegion(.trailing) {
          // The countdown was previously absent from the expanded layout
          // entirely — it existed only in compactTrailing and on the lock
          // screen, so expanding (the deliberate "tell me more" gesture) showed
          // strictly less information than the collapsed pill it came from.
          Text(timerInterval: context.attributes.windowStart...context.attributes.deadline, countsDown: true)
            .monospacedDigit()
            .font(.caption)
            .multilineTextAlignment(.trailing)
            .foregroundStyle(.white)
            .accessibilityLabel("Time left to add photos")
        }
        DynamicIslandExpandedRegion(.center) {
          Text(context.attributes.title)
            .font(.headline)
            .lineLimit(1)
            .foregroundStyle(.white)
        }
        DynamicIslandExpandedRegion(.bottom) {
          VStack(spacing: 8) {
            ProgressView(
              timerInterval: context.attributes.windowStart...context.attributes.deadline,
              countsDown: false
            ) { EmptyView() } currentValueLabel: { EmptyView() }
            .tint(colorFromHex(context.attributes.accentHex))
            .labelsHidden()

            // The bottom region was a bare full-width bar. Near the start of a
            // window it sits at ~0%, so it read as an empty divider rather than
            // progress. Pairing it with the counts and a real action gives the
            // region a reason to exist.
            HStack(spacing: 8) {
              Text("\(context.state.photoCount) photo\(context.state.photoCount == 1 ? "" : "s") · \(context.state.memberCount) here")
                .font(.caption2)
                .foregroundStyle(.white.opacity(0.7))
                .lineLimit(1)

              Spacer(minLength: 0)

              Link(destination: URL(string: "capsule://capsule/\(context.attributes.capsuleId)/camera")!) {
                Label("Add", systemImage: "camera.fill")
                  .font(.caption.weight(.semibold))
                  .foregroundStyle(.white)
                  .padding(.horizontal, 12)
                  .padding(.vertical, 6)
                  .background(
                    colorFromHex(context.attributes.accentHex),
                    in: Capsule()
                  )
              }
              .accessibilityLabel("Add a photo")
            }
          }
        }
      } compactLeading: {
        Image(systemName: "lock.fill")
          .foregroundStyle(colorFromHex(context.attributes.accentHex))
          .accessibilityLabel("Capsule locked")
      } compactTrailing: {
        // Was Text(timerInterval:) in a 44pt frame. That renders elapsed-style
        // HH:MM:SS, so a month-long window becomes "743:21:05" and either
        // truncates or blows the compact region's width. A ring carries the
        // same information at any window length, never overflows, and still
        // advances on-device with no updates from the app. The precise
        // countdown lives in the expanded and lock-screen layouts, which have
        // room for it.
        ProgressView(
          timerInterval: context.attributes.windowStart...context.attributes.deadline,
          countsDown: false
        ) { EmptyView() } currentValueLabel: { EmptyView() }
        .progressViewStyle(.circular)
        .tint(colorFromHex(context.attributes.accentHex))
        .labelsHidden()
        .accessibilityLabel("Time left to add photos")
      } minimal: {
        Image(systemName: "lock.fill")
          .foregroundStyle(colorFromHex(context.attributes.accentHex))
          .accessibilityLabel("Capsule locked")
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
