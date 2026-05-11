// app.config.js — extends app.json with runtime env vars.
// Used to inject the Google Maps API key for native map styling on iOS/Android
// without hardcoding it into the committed app.json.
//
// Expo automatically loads .env when evaluating this file, so
// EXPO_PUBLIC_GOOGLE_MAPS_API_KEY is available via process.env.

const base = require("./app.json");

const googleMapsApiKey = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY ?? "";

module.exports = {
  expo: {
    ...base.expo,
    ios: {
      ...base.expo.ios,
      config: {
        googleMapsApiKey,
      },
    },
    android: {
      ...base.expo.android,
      config: {
        googleMaps: {
          apiKey: googleMapsApiKey,
        },
      },
    },
    // react-native-maps@1.20.1 does NOT ship a config plugin (no app.plugin.js).
    // The Google Maps API key is wired into the native iOS/Android projects via
    // ios.config.googleMapsApiKey and android.config.googleMaps.apiKey above —
    // Expo applies those during prebuild without needing a plugin entry.
    plugins: [...base.expo.plugins],
  },
};
