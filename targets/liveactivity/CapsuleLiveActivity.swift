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

// Countdown display that stays inside the space the Dynamic Island and lock
// screen actually give it.
//
// `Text(timerInterval:)` renders elapsed-style HH:MM:SS with no day rollover, so
// a month-long window reads "742:55:38" and clips. Capsule windows are usually
// weeks or months, so hours-since-epoch is both unreadable and the common case.
//
// Above a day, show whole days — that's the granularity anyone actually acts on
// when a capsule locks in a month. Under a day, hand back to the ticking timer,
// where seconds genuinely matter and HH:MM:SS comfortably fits.
//
// The day count is computed at render rather than self-updating. That's fine at
// this granularity: iOS ends a Live Activity after ~8h and the reconcile pass
// re-starts it, and update() runs on every foreground — so it re-renders far
// more often than once a day. Under 24h it switches to a self-ticking timer, so
// the precision that matters is never stale.
@available(iOS 16.2, *)
@ViewBuilder
private func countdownLabel(
  windowStart: Date,
  deadline: Date
) -> some View {
  let remaining = deadline.timeIntervalSinceNow
  if remaining > 86_400 {
    // ceil so "1d left" covers the final 24h rather than showing "0d".
    Text("\(Int(ceil(remaining / 86_400)))d left")
  } else {
    // Range stays windowStart...deadline, never Date()...deadline — a live
    // lower bound traps the extension the moment the deadline passes.
    Text(timerInterval: windowStart...deadline, countsDown: true)
      .monospacedDigit()
  }
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
          countdownLabel(
            windowStart: context.attributes.windowStart,
            deadline: context.attributes.deadline
          )
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
          countdownLabel(
            windowStart: context.attributes.windowStart,
            deadline: context.attributes.deadline
          )
          .font(.caption)
          .lineLimit(1)
          .minimumScaleFactor(0.8)
          .multilineTextAlignment(.trailing)
          .foregroundStyle(.white)
          .accessibilityLabel("Time left to add photos")
        }
        DynamicIslandExpandedRegion(.center) {
          Text(context.attributes.title)
            .font(.headline)
            .lineLimit(1)
            // Capsule titles are user-supplied and the centre region is narrow;
            // shrink a little before truncating.
            .minimumScaleFactor(0.75)
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
