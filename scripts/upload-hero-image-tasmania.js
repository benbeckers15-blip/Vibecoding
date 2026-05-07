#!/usr/bin/env node
/**
 * Upload Hero Image — Tasmania (winery-tourism-tasmania)
 *
 * Uploads a local image to Firebase Cloud Storage in the live Tasmania
 * project, makes it publicly readable, and writes the resulting URL to
 * Firestore at `config/homepage.heroImageUrl` so the home screen picks it up.
 *
 * Usage:
 *   node scripts/upload-hero-image-tasmania.js                # default: hero-tamar.jpg
 *   node scripts/upload-hero-image-tasmania.js path/to/image.jpg
 */

const admin = require("firebase-admin");
const fs = require("fs");
const path = require("path");

const PROJECT_ROOT = path.join(__dirname, "..");
const SERVICE_ACCOUNT_PATH = path.join(PROJECT_ROOT, "service-account-tasmania.json");
const STORAGE_BUCKET = "winery-tourism-tasmania.firebasestorage.app";

// Source image — defaults to hero-tamar.jpg in the project root.
const sourceArg = process.argv[2] || "hero-tamar.jpg";
const sourcePath = path.isAbsolute(sourceArg)
  ? sourceArg
  : path.join(PROJECT_ROOT, sourceArg);

// Destination object name in the bucket.
const destName = `hero-images/${path.basename(sourcePath)}`;

// Pick a content-type from the extension. Keeps the upload header honest.
function inferContentType(filename) {
  const ext = path.extname(filename).toLowerCase();
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  if (ext === ".gif") return "image/gif";
  return "application/octet-stream";
}

if (!fs.existsSync(SERVICE_ACCOUNT_PATH)) {
  console.error(`❌ service-account-tasmania.json not found at ${SERVICE_ACCOUNT_PATH}`);
  process.exit(1);
}
if (!fs.existsSync(sourcePath)) {
  console.error(`❌ Source image not found: ${sourcePath}`);
  process.exit(1);
}

const serviceAccount = require(SERVICE_ACCOUNT_PATH);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  storageBucket: STORAGE_BUCKET,
});

const db = admin.firestore();
const bucket = admin.storage().bucket();

(async () => {
  try {
    console.log(`📸 Uploading ${sourcePath}`);
    console.log(`   → gs://${STORAGE_BUCKET}/${destName}`);

    const fileBuffer = fs.readFileSync(sourcePath);
    const file = bucket.file(destName);

    await file.save(fileBuffer, {
      metadata: {
        contentType: inferContentType(sourcePath),
        cacheControl: "public, max-age=86400",
      },
    });
    console.log(`✅ Uploaded to Cloud Storage`);

    // makePublic grants IAM-level public read on this object only. This is
    // independent of Firebase Storage Security Rules — even if your rules
    // deny all reads (the default), the object stays reachable via the
    // direct Cloud Storage URL below because that endpoint checks IAM, not
    // Firebase rules. Result: keep `allow read: if false` everywhere and
    // your hero image still loads, with no other paths exposed.
    await file.makePublic();
    console.log(`✅ Marked publicly readable (IAM-level, single object)`);

    // Direct Cloud Storage URL — governed by IAM only, NOT Firebase Storage
    // rules. Permanent, no expiring token, safe to store in Firestore.
    //
    // Cache-bust: append a `?v=<timestamp>` query param so React Native's
    // <Image> cache and Google's edge CDN both treat each upload as a fresh
    // resource. Without this, repeated uploads land at an identical URL and
    // the device keeps serving the previously cached bytes.
    const cacheBustedUrl =
      `https://storage.googleapis.com/${STORAGE_BUCKET}/${destName}?v=${Date.now()}`;
    console.log(`🔗 ${cacheBustedUrl}`);

    await db.collection("config").doc("homepage").set(
      {
        heroImageUrl: cacheBustedUrl,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    console.log(`✅ Firestore config/homepage.heroImageUrl updated`);

    console.log(`\n🎉 Done. Reload the app to see the new hero image.`);
    process.exit(0);
  } catch (e) {
    console.error("❌ Failed:", e.message);
    process.exit(1);
  }
})();
