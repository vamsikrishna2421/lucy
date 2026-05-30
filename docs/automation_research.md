# LUCY Automation Research
*Generated: 2026-05-30 | Knowledge base: August 2025*

## Strategic Insight
LUCY's competitive advantage is CONTEXT. The automation layer closes the loop from insight to action.
The right architecture: **LUCY proposes, user confirms in one tap** (v1). Build trust first, then autonomous mode.

## What's Possible RIGHT NOW (Phase 1 — Zero Extra Permissions)

| Feature | Mechanism | Effort | Value |
|---|---|---|---|
| Set timer | Android: ACTION_SET_TIMER; iOS: Shortcuts URL | 1 day | Very High |
| Phone call | tel: URL scheme | 1 day | Very High |
| Navigate | maps:// URL scheme | 1 day | High |
| Play playlist | Spotify/Apple Music URL scheme | 2 days | High |
| Trigger iOS Shortcut | shortcuts://run-shortcut?name=X | 1 day | Very High |
| Pre-fill email | mailto: URL scheme | 1 day | High |
| Pre-fill SMS | sms: URL scheme | 1 day | High |
| Open any app | Linking.openURL with URL scheme | 1 day | Medium |
| Actionable notifications | expo-notifications actions | Already built | Very High |

## Phase 2 — Standard Permissions (Calendar, Contacts, Location)

| Feature | Permission | Effort | Value |
|---|---|---|---|
| Create calendar event | Calendar | 2-3 days | Extremely High |
| Create reminder (grocery list etc.) | Reminders | 2 days | Extremely High |
| Geofenced reminder ("when I arrive at X") | Location Always | 4-5 days | Very High |
| Add to Reminders list | Reminders | 2 days | Extremely High |
| Contact lookup for messaging/calling | Contacts | 1 day | High |

## Phase 3 — Native Swift/Kotlin Required

| Feature | Tech | Effort | Value |
|---|---|---|---|
| "Hey Siri, [LUCY action]" | App Intents (Swift) | 2-3 weeks | Very High |
| HomeKit direct control | HomeKit (Swift) | 2-3 weeks | High |
| HealthKit log workout/sleep | HealthKit entitlement | 1-2 weeks | Medium |
| iOS Focus mode | FocusFilterIntent | 1-2 weeks | High |
| Android Google Assistant | App Actions (Kotlin) | 2 weeks | High |
| Interactive widgets | WidgetKit (Swift) | 2-3 weeks | High |

## Phase 4 — Requires Business Dev or Enterprise

- Email send without confirmation (backend SMTP)
- Restaurant/travel booking (API partnerships)
- Screen Time / app blocking (private API or MDM)
- Full UI automation (Accessibility Service — restricted)

## The Shortcuts Bridge Strategy

**Most powerful immediate move**: Build a robust "LUCY Shortcuts integration" that lets users connect any iOS Shortcut to a LUCY voice trigger. This unlocks: HomeKit, Focus modes, ANY app control — with zero additional native code from LUCY's side. Users pre-configure their Shortcuts, LUCY triggers them by name.

`shortcuts://run-shortcut?name=Morning+Routine`

## Architecture: Intent → Action

```
Passive input → Intent classifier → Slot filler → Action executor → Confirm → Execute → Log
```

**Taxonomy of action types:**
CALL, REMIND, NAVIGATE, MEDIA, SMART_HOME, CALENDAR, MESSAGE, SHOPPING, TIMER, ROUTINE

**Safety guardrails:**
- Action allowlist (only taxonomy items)
- Reversibility tagging (irreversible = always confirm)
- Contact scope limit (only user's contacts)
- No financial actions without explicit permission
- Frequency rate limiting
- Audit log (visible to user)
- Kill switch (one setting disables all automations)

## Existing Art

- **Rabbit R1 LAM**: Trains on UI interactions, navigates apps like a human. Cloud-dependent, breaks on app updates. Not viable for consumer app.
- **Apple Intelligence (iOS 18+)**: App Intents = Siri integration. LUCY implementing App Intents → "Hey Siri, capture a thought in LUCY" works automatically.
- **Gemini Nano (Android 14+)**: On-device model via AICore API. LUCY could use for intent classification — zero latency, offline, free.
- **Mobile-Agent / AppAgent**: Screenshot-based LLM agents. Require ADB (computer-connected). Not viable for consumer app.

## Priority Order

1. Create reminder / grocery list (Phase 2, expo-calendar)
2. Create calendar event (Phase 2, expo-calendar)
3. Phone call / SMS / navigate (Phase 1, URL schemes)
4. Geofenced reminder (Phase 2)
5. iOS Shortcuts bridge (Phase 1, highest leverage)
6. Play playlist (Phase 1)
7. Morning briefing with calendar context (Phase 2, already partially built)
8. Siri App Intents (Phase 3, premium iOS experience)
