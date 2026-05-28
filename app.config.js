module.exports = ({ config }) => {
  const expo = {
    ...config,
    plugins: (config.plugins ?? []).map((plugin) =>
      Array.isArray(plugin)
        ? [
            plugin[0],
            {
              ...(plugin[1] ?? {}),
              android: { ...(plugin[1]?.android ?? {}) },
            },
          ]
        : plugin,
    ),
  };
  const usesDevelopmentAssetRelay = Boolean(process.env.EXPO_PUBLIC_DEVICE_MODEL_ASSET_BASE_URL);

  if (usesDevelopmentAssetRelay) {
    const buildProperties = expo.plugins.find(
      (plugin) => Array.isArray(plugin) && plugin[0] === 'expo-build-properties',
    );

    if (buildProperties) {
      buildProperties[1].android.usesCleartextTraffic = true;
    }
  }

  return expo;
};
