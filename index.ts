// Expo's release runtime patches network globals during import. Ensure React
// Native's standard environment is initialized first on bundled Hermes builds.
require('react-native/Libraries/Core/InitializeCore');

// Prevent the splash screen from auto-hiding before the app finishes startup.
// Must be called before any component renders.
const SplashScreen = require('expo-splash-screen') as typeof import('expo-splash-screen');
void SplashScreen.preventAutoHideAsync();
// splashShownAt lives in src/splashTime.ts (no circular dep with App.tsx)

const { registerRootComponent } = require('expo') as typeof import('expo');
const App = require('./App').default as typeof import('./App').default;

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
