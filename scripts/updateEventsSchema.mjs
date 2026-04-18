// scripts/updateEventsSchema.mjs
// Reads the events collection and adds any missing new fields to each document.

import { initializeApp } from "firebase/app";
import {
  initializeFirestore,
  collection,
  getDocs,
  updateDoc,
  doc,
} from "firebase/firestore";

const firebaseConfig = {
  apiKey:            "AIzaSyA5TNrAIwxLBHnlAb9Sv7vUtwdz-edoFAc",
  authDomain:        "solid-garden-474012-q4.firebaseapp.com",
  projectId:         "solid-garden-474012-q4",
  storageBucket:     "solid-garden-474012-q4.appspot.com",
  messagingSenderId: "386342294467",
  appId:             "1:386342294467:web:adbc90bbf6735efb142376",
};

const app = initializeApp(firebaseConfig);
const db  = initializeFirestore(app, { experimentalForceLongPolling: true });

// New fields to add — only written if the field does not already exist on the doc
const NEW_FIELDS = {
  startDate:        null,   // "YYYY-MM-DD"  — populate manually per event
  endDate:          null,   // "YYYY-MM-DD"  — populate manually per event
  venue:            null,   // venue / location name string
  isWinerySponsored: false, // boolean
  sourceUrl:        null,   // link to margaretriver.com listing
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
