#!/usr/bin/env node
/**
 * needs-rebuild — decides whether changes since the last build can ship over-the-air
 * (EAS Update, <1 min) or require a full native Codemagic rebuild.
 *
 * WHY: we use a FIXED runtimeVersion ("1") instead of the fingerprint policy, because
 * Codemagic (which prebuilds ios/android) and this Windows laptop (which can't, due to the
 * executorch MAX_PATH limit) would compute different fingerprints and OTA would silently
 * never apply. A fixed string is predictable — but it shifts the responsibility onto us to
 * bump it when something NATIVE changes. This script is that safety net: it inspects the
 * diff and flags native-affecting changes so we never push a JS-only OTA to a build that
 * can't run it.
 *
 * Usage:
 *   node tools/needs-rebuild.mjs                 # diff since the last build-* git tag (or HEAD~1)
 *   node tools/needs-rebuild.mjs <ref>           # diff <ref>..HEAD (e.g. a built commit/tag)
 *   npm run ota:check
 *
 * Exit code: 0 = OTA-safe, 1 = rebuild required (handy in CI/precommit).
 */
import { execSync } from 'node:child_process';

const C = { red: '\x1b[31m', grn: '\x1b[32m', yel: '\x1b[33m', dim: '\x1b[2m', bold: '\x1b[1m', off: '\x1b[0m' };
const sh = (cmd) => execSync(cmd, { encoding: 'utf8' }).trim();

// Baseline: explicit arg → last `build-*` tag → previous commit.
let ref = process.argv[2];
if (!ref) {
  try { ref = sh('git describe --tags --match "build-*" --abbrev=0'); } catch { ref = 'HEAD~1'; }
}

let files = [];
try {
  files = sh(`git diff --name-only ${ref} HEAD`).split('\n').filter(Boolean);
} catch (e) {
  console.error(`${C.red}Could not diff against "${ref}". Pass a valid commit/tag.${C.off}`);
  process.exit(2);
}
// Also include uncommitted changes so a pre-push check is honest.
try {
  const dirty = sh('git diff --name-only HEAD').split('\n').filter(Boolean);
  files = [...new Set([...files, ...dirty])];
} catch { /* ignore */ }

if (!files.length) {
  console.log(`${C.dim}No changes since ${ref}.${C.off}`);
  process.exit(0);
}

// Paths whose change implies a NATIVE rebuild (not OTA-able). package.json/lock are
// handled separately (only a `dependencies` change matters, not scripts/metadata).
const NATIVE_FILE = [
  /^ios\//, /^android\//, /^patches\//, /^plugins\//,
  /^app\.config\.[jt]s$/, /^metro\.config\.[jt]s$/, /^babel\.config\.[jt]s$/,
  /^expo-module\.config\.json$/, /^eas\.json$/, /^codemagic\.ya?ml$/,
];
// True only if the runtime `dependencies` map actually changed between ref and HEAD
// (devDependencies don't ship; scripts/version/metadata are OTA-irrelevant).
function dependenciesChanged() {
  try {
    const before = JSON.parse(sh(`git show ${ref}:package.json`)).dependencies || {};
    const after = JSON.parse(sh('git show HEAD:package.json')).dependencies || {};
    const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
    const diff = [];
    for (const k of keys) if (before[k] !== after[k]) diff.push(`${k}${before[k] ? (after[k] ? ' updated' : ' removed') : ' added'}`);
    return diff;
  } catch { return ['(could not parse package.json — assume native)']; }
}
// app.json keys that touch the native build (vs OTA-able JS-side config).
const NATIVE_APP_JSON_KEYS = ['plugins', 'ios', 'android', 'updates', 'runtimeVersion', 'scheme', 'newArchEnabled', 'jsEngine', 'permissions', 'entitlements', 'infoPlist'];

const reasons = [];
const otaFiles = [];

for (const f of files) {
  if (/^package(-lock)?\.json$/.test(f) || /^(yarn\.lock|pnpm-lock\.yaml)$/.test(f)) {
    // Only a runtime `dependencies` change forces a rebuild; scripts/lock churn is OTA-safe.
    if (f === 'package.json') {
      const deps = dependenciesChanged();
      if (deps.length) reasons.push(`package.json — dependencies changed: ${deps.join(', ')} (verify native)`);
      else otaFiles.push('package.json (scripts/metadata only)');
    }
    // package-lock / yarn.lock alone follow deps; ignore unless deps changed (handled above).
    continue;
  }
  const native = NATIVE_FILE.find((re) => re.test(f));
  if (native) {
    reasons.push(`${f} — native project file`);
  } else if (f === 'app.json') {
    // Inspect which app.json keys actually changed.
    let changedNativeKeys = [];
    try {
      const before = JSON.parse(sh(`git show ${ref}:app.json`)).expo || {};
      const after = JSON.parse(sh('git show HEAD:app.json')).expo || {};
      for (const k of NATIVE_APP_JSON_KEYS) {
        if (JSON.stringify(before[k]) !== JSON.stringify(after[k])) changedNativeKeys.push(k);
      }
    } catch { changedNativeKeys = ['(could not parse — assume native)']; }
    if (changedNativeKeys.length) reasons.push(`app.json — native keys changed: ${changedNativeKeys.join(', ')}`);
    else otaFiles.push(`${f} (JS-side config only)`);
  } else {
    otaFiles.push(f);
  }
}

console.log(`\n${C.bold}needs-rebuild${C.off}  ${C.dim}(since ${ref}, ${files.length} file${files.length === 1 ? '' : 's'} changed)${C.off}\n`);

if (reasons.length) {
  console.log(`${C.red}${C.bold}⛔ REBUILD REQUIRED${C.off} — native changes can't ship over-the-air:\n`);
  for (const r of reasons) console.log(`   ${C.red}•${C.off} ${r}`);
  console.log(`\n   ${C.yel}Next:${C.off} bump ${C.bold}runtimeVersion${C.off} in app.json (\"1\" → \"2\"), commit, push,`);
  console.log(`         and start a ${C.bold}Codemagic${C.off} build. (OTA updates won't reach this build until then.)`);
  if (otaFiles.length) console.log(`\n   ${C.dim}(also changed, OTA-able: ${otaFiles.slice(0, 6).join(', ')}${otaFiles.length > 6 ? '…' : ''})${C.off}`);
  console.log('');
  process.exit(1);
}

console.log(`${C.grn}${C.bold}✅ OTA-SAFE${C.off} — JS/asset only, ship without a rebuild:\n`);
for (const f of otaFiles.slice(0, 20)) console.log(`   ${C.grn}•${C.off} ${f}`);
if (otaFiles.length > 20) console.log(`   ${C.dim}…and ${otaFiles.length - 20} more${C.off}`);
console.log(`\n   ${C.yel}Next:${C.off} ${C.bold}npx eas update --branch production -m "what changed"${C.off}\n`);
process.exit(0);
