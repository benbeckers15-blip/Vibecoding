// firebaseConfig.js
import AsyncStorage from "@react-native-async-storage/async-storage";
import { initializeApp } from "firebase/app";
import { getReactNativePersistence, initializeAuth } from "firebase/auth";
import { initializeFirestore } from "firebase/firestore";
import { getFunctions } from "firebase/functions";
import { getStorage } from "firebase/storage";

const firebaseConfig = {
  apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID,
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Auth — AsyncStorage persistence keeps the user logged in across app restarts
export const auth = initializeAuth(app, {
  persistence: getReactNativePersistence(AsyncStorage),
});

// Firestore
//   • experimentalForceLongPolling — required for Expo + non-US regions
//   • Cache: in-memory only. Firestore's `persistentLocalCache(...)` uses
//     IndexedDB, which doesn't exist in React Native — turning it on
//     produces the "Error using user provided cache. Falling back to
//     memory cache" warning on every boot and silently degrades to memory
//     anyway. Reads are still cached within a single app session; the
//     cache just doesn't survive a cold restart. If we ever need true
//     offline persistence, migrate to @react-native-firebase/firestore
//     (native modules) — the JS SDK can't do it in RN.
export const db = initializeFirestore(app, {
  experimentalForceLongPolling: true,
});

export const storage = getStorage(app);

// Callable Functions — used for actions that require server-side privileges
// (e.g. account deletion needs the Admin SDK to wipe Auth + subcollections).
// Region must match how the functions are deployed (us-central1 is the default).
export const functions = getFunctions(app, "us-central1");
