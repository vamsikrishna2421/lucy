// Neutral module — no deps on App or index — records when JS first ran.
// Used by App.tsx to calculate how long to show the splash screen.
export const splashShownAt = Date.now();
