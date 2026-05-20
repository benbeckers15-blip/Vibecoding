// scripts/updateEventsSchema.mjs
// Reads the events collection and adds any missing new fields to each document.
//
// Targets the active Firestore project via env vars (same vars the app reads).
// Run with the Tasmania env loaded, e.g.:
//
//   node --env-file=.env scripts/updateEventsSchema.mjs
//
// or export the EXPO_PUBLIC_FIREBASE_* variables before invoking.

import { initializeApp } from "firebase/app";
import {
  initializeFirestore,
  collection,
  getDocs,
  updateDoc,
  doc,
} from "firebase/firestore";

const requiredEnv = [
  "EXPO_PUBLIC_FIREBASE_API_KEY",
  "EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN",
  "EXPO_PUBLIC_FIREBASE_PROJECT_ID",
  "EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET",
  "EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID",
  "EXPO_PUBLIC_FIREBASE_APP_ID",
];
const missingEnv = requiredEnv.filter((k) => !process.env[k]);
if (missingEnv.length > 0) {
  console.error(
    `Missing required env vars: ${missingEnv.join(", ")}\n` +
      `Load .env first (e.g. \`node --env-file=.env scripts/updateEventsSchema.mjs\`).`
  );
  process.exit(1);
}

const firebaseConfig = {
  apiKey:            process.env.EXPO_PUBLIC_FIREBASE_API_KEY,
  authDomain:        process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId:         process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket:     process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId:             process.env.EXPO_PUBLIC_FIREBASE_APP_ID,
};

console.log(`Connecting to Firestore project: ${firebaseConfig.projectId}\n`);

const app = initializeApp(firebaseConfig);
const db  = initializeFirestore(app, { experimentalForceLongPolling: true });

// New fields to add — only written if the field does not already exist on the doc
const NEW_FIELDS = {
  startDate:         null,  // "YYYY-MM-DD" — populate manually per event
  endDate:           null,  // "YYYY-MM-DD" — populate manually per event
  venue:             null,  // venue / location name string
  isWinerySponsored: false, // boolean
  sourceUrl:         null,  // link to the source listing for this event
};

async function run() {
  console.log("Fetching events collection…\n");

  const snapshot = await getDocs(collection(db, "events"));

  if (snapshot.empty) {
    console.log("No documents found in the events collection.");
    process.exit(0);
  }

  console.log(`Found ${snapshot.size} event document(s).\n`);

  for (const docSnap of snapshot.docs) {
    const data = docSnap.data();
    console.log(`─── Document: ${docSnap.id}`);
    console.log(`    title:    ${data.title ?? "(none)"}`);
    console.log(`    date:     ${data.date ?? "(none)"}`);

    // Only write fields that are completely absent from the document
    const missing = {};
    for (const [key, defaultValue] of Object.entries(NEW_FIELDS)) {
      if (!(key in data)) {
        missing[key] = defaultValue;
      }
    }

    if (Object.keys(missing).length === 0) {
      console.log("    ✓ All fields already present — skipping.\n");
      continue;
    }

    console.log(`    Adding fields: ${Object.keys(missing).join(", ")}`);
    await updateDoc(doc(db, "events", docSnap.id), missing);
    console.log("    ✓ Updated.\n");
  }

  console.log("Done.");
  process.exit(0);
}

run().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
