# Alarm-grade high-priority notifications (backlog #1)

Goal: LUCY's high-priority nudges (office submissions, meetings, deadlines) behave like an ALARM —
pinned, vibrating, re-ringing until tapped, breaking through silent/Focus.

## Shipped OTA (runtime 4, persistentReminders.ts)
- Re-ring cadence tightened **3 min → 30 seconds**; bounded burst (~14 buzzes ≈ 7 min) per key.
- Firmer vibration pattern; `sound: true` each buzz; one tap cancels the whole remaining burst.
- `interruptionLevel: 'timeSensitive'` set on every buzz (honored once the entitlement ships — see below).
- Delivered notifications already persist in Notification Center until the user clears them.

### Why bounded, not infinite
iOS hard-caps **64 pending local notifications across the whole app**. An unbounded 30s loop would
blow that budget (and starve other reminders). The aggressive 7-min burst is the realistic OTA ceiling;
true until-tapped persistence needs a Live Activity (below).

## Needs a native build (next build) — NOT OTA-able
1. **Time-Sensitive entitlement** (`com.apple.developer.usernotifications.time-sensitive`) — makes
   `interruptionLevel:'timeSensitive'` actually break through Focus/DND. Add via app config
   (expo-notifications / a config plugin or `ios.entitlements`). No Apple review needed.
2. **Critical Alerts** (`com.apple.developer.usernotifications.critical-alerts`) — to force sound/vibrate
   even on silent. Requires a **special Apple entitlement request** (justification + approval). Optional.
3. **Live Activity / Dynamic Island** (ActivityKit) — the only way to PIN a persistent, always-visible
   countdown/alert that stays until acted on. Needs a native module (e.g. a custom dev-client widget
   extension or a community lib like `expo-live-activity`/`react-native-live-activity`), an App Group,
   and a SwiftUI widget. Sizeable — its own build + plan. This is what delivers "stays on the island
   until I click it."
4. **Android** ongoing/`FLAG_ONGOING` full-screen-intent alarm — can be pushed further with a custom
   high-importance + full-screen intent (closer to a real alarm) on a dev build.

## Suggested next step when building
Add the Time-Sensitive entitlement in the next EAS build (cheap, high value), then scope the Live
Activity widget as a dedicated effort (ActivityKit + App Group + SwiftUI). Until then, the 30s burst is
the strongest OTA-only behavior.
