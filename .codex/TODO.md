# Next Priorities

1. Install the keyboard-focus hotfix Android ARM64 beta on the phone that reported the blink-dismiss problem; confirm ordinary typing works in Capture and Ask, then validate model preparation, per-device GPT Nano key setup, protected-toggle behavior with fake sensitive details, reminders, Ask, and re-organization.
2. Produce the iOS TestFlight beta after the user signs into EAS and supplies Apple Developer/App Store Connect signing access; validate on a physical iPhone.
3. Improve Eleanor chronological retrieval beyond the initial `9/50` top-five baseline using structured memory indexing and reranking, then run end-to-end answer comparison with local mobile models and GPT-5.4 Nano.
4. Evaluate the experimental protected-remote masking lane on a synthetic privacy suite before accepting real secrets; improve it or revert protected entries to local-only if misses are found.
5. Expand the in-app benchmark to run/export the 100-case outcome catalog by selected local model; Claude and OpenAI Eleanor oracle-memory comparisons are now complete.
6. Add contextual follow-up resolution in Ask Memory answers (`What about its deadlines?`, `Who else?`) while keeping raw source/timestamp provenance internal rather than requiring users to inspect captured storage.
7. Improve natural English entity and relationship extraction beyond bounded project/work task phrases, using privacy-safe local handling and correction prompts for uncertain links.
8. Record the Eleanor Kaggle page URL alongside the user-confirmed MIT license before publishing redistributed benchmark fixtures or result reports.
9. Benchmark an iPhone-local Apple Foundation Models extraction lane on supported iOS hardware, alongside Qwen/Phi local and Claude remote lanes.
10. Add optional organization timing preferences for overnight/charging intent while remaining honest that Android/iOS schedule background execution opportunistically; on-demand re-organization and last-run visibility are complete.
11. Add correction actions in Memory so a user can reject, confirm, or merge a derived connection, preserving provenance and retriggering organization.
12. Generalize contextual follow-up linking and derived-artifact cleanup beyond payments with conservative confidence rules, explainable archive reasons, and clarification prompts where appropriate.
13. Return to production-grade sensitivity detection after the outcome/retrieval sprint; benchmark experiments now have local `phi3` plus deterministic redaction, while app defaults remain private-first.
14. Add reminder management: cancel/reschedule/delete notifications, suppress stale test reminders, and ask for a time when a reminder lacks one.
15. Verify iOS on-device inference, sharing, notifications, background tasks, branding, and Ask LUCY on a physical iPhone through EAS/TestFlight.
16. Automate the physical short-path Android build copy, or move the repository to a shorter path, because ExecuTorch CMake does not build through the previous junction workaround.
17. Before a public or sponsored beta, replace bring-your-own-key testing with an authenticated, rate-limited relay or subscription flow; never bundle a sponsor API key in the application binary.
