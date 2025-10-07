// firebaseConfig.js
import { initializeApp } from "firebase/app";
import { initializeFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";

// ✅ Check if .env variables are actually being read
console.log("🔑 Firebase API Key:", process.env.EXPO_PUBLIC_FIREBASE_API_KEY ? "Loaded" : "Missing");
console.log("🏷️ Firebase Project ID:", process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID);

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

// ✅ Fix for Expo + React Native environments
export const db = initializeFirestore(app, {
  experimentalForceLongPolling: true,
  useFetchStreams: false,
  cacheSizeBytes: -1,
});

export const storage = getStorage(app);
