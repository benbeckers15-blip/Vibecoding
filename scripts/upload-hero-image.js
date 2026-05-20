#!/usr/bin/env node
//
// Upload a local image as the homepage hero, then store its public URL in
// Firestore at config/homepage.heroImageUrl.
//
// Usage:
//   node scripts/upload-hero-image.js <path-to-image>
//
// Targets the Tasmania Firestore project via service-account-tasmania.json.

const admin = require("firebase-admin");
const fs = require("fs");
const path = require("path");

const SERVICE_ACCOUNT_PATH = path.resolve(
  __dirname,
  "..",
  "service-account-tasmania.json"
);

if (!fs.existsSync(SERVICE_ACCOUNT_PATH)) {
  console.error(
    `Service account JSON not found at: ${SERVICE_ACCOUNT_PATH}\n` +
      `Place service-account-tasmania.json in the repo root before running.`
  );
  process.exit(1);
}

const serviceAccount = require(SERVICE_ACCOUNT_PATH);
const PROJECT_ID = serviceAccount.project_id;
const STORAGE_BUCKET = `${PROJECT_ID}.firebasestorage.app`;

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  storageBucket: STORAGE_BUCKET,
});

const db = admin.firestore();
const storage = admin.storage();

async function uploadHeroImage() {
  try {
    // Allow the image path to be passed as an argv, fall back to a default.
    const argPath = process.argv[2];
    const imagePath = argPath
      ? path.resolve(argPath)
      : path.join(__dirname, "..", "hero.jpg");

    console.log(`Project:    ${PROJECT_ID}`);
    console.log(`Bucket:     ${STORAGE_BUCKET}`);
    console.log(`Uploading:  ${imagePath}`);

    if (!fs.existsSync(imagePath)) {
      throw new Error(`File not found: ${imagePath}`);
    }

    const fileBuffer = fs.readFileSync(imagePath);
    const fileName = `hero-images/${path.basename(imagePath)}`;

    const bucket = storage.bucket();
    const file = bucket.file(fileName);

    await file.save(fileBuffer, {
      metadata: { contentType: "image/jpeg" },
    });

    console.log(`✓ Uploaded to: ${fileName}`);

    await file.makePublic();

    // Build a permanent public URL (never expires)
    const downloadUrl =
      `https://firebasestorage.googleapis.com/v0/b/${STORAGE_BUCKET}` +
      `/o/${encodeURIComponent(fileName)}?alt=media`;

    console.log(`Download URL: ${downloadUrl}`);

    await db.collection("config").doc("homepage").set(
      {
        heroImageUrl: downloadUrl,
        updatedAt: new Date(),
      },
      { merge: true }
    );

    console.log("✓ Firestore config/homepage updated.");
    console.log("\nDone.");
  } catch (error) {
    console.error("Error uploading image:", error.message);
    process.exit(1);
  }
}

uploadHeroImage();
