// app.config.js — extends app.json (passed in as `config`) with runtime env vars.
// Used to inject the Google Maps API key into native config without
// hardcoding it in the committed app.json.
//
// Expo automatically loads .env when evaluating this file, so
// EXPO_PUBLIC_GOOGLE_MAPS_API_KEY is available via process.env.
//
// Since react-native-maps 1.2x the package ships its own config plugin, which
// wires the Google Maps SDK into the iOS Podfile / AppDelegate and the Android
// manifest. That replaces the old ios.config.googleMapsApiKey /
// android.config.googleMaps.apiKey fields used on SDK 54.

const googleMapsApiKey = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY ?? "";

module.exports = ({ config }) => ({
  ...config,
  plugins: [
    ...(config.plugins ?? []),
    [
      "react-native-maps",
      {
        iosGoogleMapsApiKey: googleMapsApiKey,
        androidGoogleMapsApiKey: googleMapsApiKey,
      },
    ],
  ],
});
