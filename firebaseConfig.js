// firebaseConfig.js
import { initializeApp } from "firebase/app";
import { initializeFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";

const firebaseConfig = {
  apiKey: "AIzaSyA5TNrAIwxLBHnlAb9Sv7vUtwdz-edoFAc",
  authDomain: "solid-garden-474012-q4.firebaseapp.com",
  projectId: "solid-garden-474012-q4",
  storageBucket: "solid-garden-474012-q4.appspot.com",
  messagingSenderId: "386342294467",
  appId: "1:386342294467:web:adbc90bbf6735efb142376",
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// 👇 Fix: use long polling for Expo + non-US regions
export const db = initializeFirestore(app, {
  experimentalForceLongPolling: true,
});

export const storage = getStorage(app);
