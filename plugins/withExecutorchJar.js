// Expo config plugin — fixes on-device executorch on Android.
//
// react-native-executorch ships its runtime (org.pytorch.executorch.*, incl. the LLM `Module` and the
// voice `AsrModule`) as a LOCAL jar inside its Android *library* module:
//     implementation files('libs/classes.jar')
// Android/Gradle does NOT propagate a library module's local *file* dependencies into the consuming
// app, so those classes never get dexed into the final APK. At runtime the native libexecutorch.so
// loads but `org.pytorch.executorch.Module` is ClassNotFound → fatal HostException when on-device AI or
// voice transcription is touched (white screen). The native .so is fine; only the Java classes are missing.
//
// Fix: add that same jar to the APP module's dependencies so its classes ARE packaged into the app.
const { withAppBuildGradle } = require('@expo/config-plugins');

const JAR_PATH = '$rootDir/../node_modules/react-native-executorch/android/libs/classes.jar';
const MARKER = 'react-native-executorch/android/libs/classes.jar';
const DEP_LINE = `    implementation files("${JAR_PATH}") // executorch runtime classes (see plugins/withExecutorchJar.js)`;

module.exports = function withExecutorchJar(config) {
  return withAppBuildGradle(config, (cfg) => {
    if (cfg.modResults.language !== 'groovy') {
      throw new Error('withExecutorchJar: expected android/app/build.gradle to be Groovy');
    }
    let contents = cfg.modResults.contents;
    if (contents.includes(MARKER)) return cfg; // idempotent
    if (!/\ndependencies\s*\{/.test(contents)) {
      throw new Error('withExecutorchJar: could not find a dependencies { } block in app/build.gradle');
    }
    contents = contents.replace(/\ndependencies\s*\{/, `\ndependencies {\n${DEP_LINE}`);
    cfg.modResults.contents = contents;
    return cfg;
  });
};
