#!/usr/bin/env node

const admin = require("firebase-admin");
const fs = require("fs");
const path = require("path");
const os = require("os");

// Initialize Firebase Admin
const serviceAccount = require("../service-account.json");
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  storageBucket: "solid-garden-474012-q4.firebasestorage.app",
});

const db = admin.firestore();
const storage = admin.storage();

async function uploadHeroImage() {
  try {
    // Path to the image in project folder
    const desktopPath = path.join(__dirname, "..", "Vasse-Felix-Restaurant.jpg");

    console.log(`📸 Uploading image from: ${desktopPath}`);

    // Check if file exists
    if (!fs.existsSync(desktopPath)) {
      throw new Error(`File not found: ${desktopPath}`);
    }

    // Read the file
    const fileBuffer = fs.readFileSync(desktopPath);
    const fileName = "hero-images/margaret-river-hero.jpg";

    // Upload to Firebase Storage
    const bucket = storage.bucket();
    const file = bucket.file(fileName);

    await file.save(fileBuffer, {
      metadata: {
        contentType: "image/jpeg",
      },
    });

    console.log(`✅ Image uploaded to Firebase Storage: ${fileName}`);

    // Make the file publicly accessible
    await file.makePublic();

    // Build a permanent public URL (never expires)
    const downloadUrl = `https://firebasestorage.googleapis.com/v0/b/solid-garden-474012-q4.firebasestorage.app/o/${encodeURIComponent(fileName)}?alt=media`;

    console.log(`🔗 Download URL: ${downloadUrl}`);

    // Save the URL to Firestore in a config document
    await db.collection("config").doc("homepage").set(
      {
        heroImageUrl: downloadUrl,
        updatedAt: new Date(),
      },
      { merge: true }
    );

    console.log(`✅ Firestore config updated with image URL`);
    console.log(`\n🎉 Success! Your hero image is now live.`);
  } catch (error) {
    console.error("❌ Error uploading image:", error.message);
    process.exit(1);
  }
}

uploadHeroImage();
