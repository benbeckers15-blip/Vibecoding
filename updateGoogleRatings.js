/**
 * updateGoogleRatings.js
 * 
 * Fetches Google Ratings for all wineries in Firestore and stores them
 * in a dedicated collection/document for your app to read.
 */

import admin from "firebase-admin";
import fs from "fs";
import fetch from "node-fetch";
import path from "path";

// --- Load Firebase Admin credentials ---
const serviceAccount = JSON.parse(
  fs.readFileSync(path.resolve("./firebase-admin.json"), "utf8")
);

// --- Initialize Firebase Admin ---
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});
const db = admin.firestore();

// --- Your Google API Key (from .env) ---
const GOOGLE_API_KEY = process.env.EXPO_PUBLIC_GOOGLE_API_KEY;

if (!GOOGLE_API_KEY) {
  console.error("❌ Missing Google API key. Add it to your .env.");
  process.exit(1);
}

// --- Helper function to fetch rating from Google Places ---
async function fetchRating(placeId) {
  if (!placeId) return null;

  const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&fields=rating,user_ratings_total&key=${GOOGLE_API_KEY}`;

  try {
    const res = await fetch(url);
    const data = await res.json();

    if (data.status !== "OK") {
      console.warn(`Google API Error for ${placeId}:`, data.status);
      return null;
    }

    return {
      rating: data.result.rating || null,
      userRatingsTotal: data.result.user_ratings_total || 0,
    };
  } catch (err) {
    console.error("Failed fetching rating:", err);
    return null;
  }
}

// --- Main function ---
async function updateRatings() {
  console.log("Fetching wineries from Firestore...");

  const snapshot = await db.collection("wineries").get();
  const wineries = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));

  const ratingsUpdates = {};

  for (const winery of wineries) {
    console.log(`Fetching rating for: ${winery.name}`);
    const ratingData = await fetchRating(winery.googlePlaceId);
    ratingsUpdates[winery.id] = {
      name: winery.name,
      rating: ratingData?.rating || null,
      userRatingsTotal: ratingData?.userRatingsTotal || 0,
      updatedAt: new Date(),
    };
  }

  // --- Store in Firestore under a single document ---
  await db.collection("googleRatings").doc("latest").set(ratingsUpdates);

  console.log("✅ Ratings updated successfully!");
}

// --- Run script ---
updateRatings().catch((err) => console.error(err));
