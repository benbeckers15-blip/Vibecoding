#!/usr/bin/env node
/**
 * Set Hero Image Crop Position — Tasmania (winery-tourism-tasmania)
 *
 * Updates `config/homepage.heroImagePositionX`, `heroImagePositionY`, and
 * `heroImageZoom` in Firestore so the home screen can re-anchor AND tighten
 * the cover-cropped hero image without rebuilding and re-submitting the app.
 *
 * X / Y are 0–100 percentages of the cropped image (the focal anchor):
 *   X: 0 = left edge   · 50 = horizontal center · 100 = right edge
 *   Y: 0 = top edge    · 50 = vertical center   · 100 = bottom edge
 * Default (50, 50) = perfectly centered (expo-image's built-in default).
 *
 * ZOOM is an optional scale multiplier (defaults to 1):
 *   1.0 = no extra zoom (raw `cover` crop, what the previous script did)
 *   1.5 = 50% tighter crop (image enlarged, more cropped away)
 *   2.0 = 2× zoom (only the central quarter visible, etc.)
 * The zoom pivots around the X/Y focal point, so increasing zoom keeps the
 * same area in view and just crops more aggressively around it.
 * Hard-capped at 4.0 to avoid blurry over-zoom.
 *
 * Usage:
 *   node scripts/set-hero-position.js <horizontal%> <vertical%> [zoom]
 *
 * Examples:
 *   node scripts/set-hero-position.js 50 20         # center, anchored near top
 *   node scripts/set-hero-position.js 50 80         # center, anchored near bottom
 *   node scripts/set-hero-position.js 50 50 1.4     # centered, 40% tighter crop
 *   node scripts/set-hero-position.js 30 70 1.8     # bottom-left focus, big zoom
 *
 * After running, force-reload the app (shake → Reload, or stop/restart) to
 * see the new crop. No EAS build, no App Store push.
 */

const admin = require("firebase-admin");
const fs = require("fs");
const path = require("path");

const PROJECT_ROOT = path.join(__dirname, "..");
const SERVICE_ACCOUNT_PATH = path.join(PROJECT_ROOT, "service-account-tasmania.json");

if (!fs.existsSync(SERVICE_ACCOUNT_PATH)) {
  console.error(`❌ service-account-tasmania.json not found at ${SERVICE_ACCOUNT_PATH}`);
  process.exit(1);
}

const [, , xRaw, yRaw, zoomRaw] = process.argv;
if (xRaw == null || yRaw == null) {
  console.error("Usage: node scripts/set-hero-position.js <horizontal%> <vertical%> [zoom]");
  console.error("       e.g.  node scripts/set-hero-position.js 50 20");
  console.error("       e.g.  node scripts/set-hero-position.js 50 50 1.5");
  process.exit(1);
}

const x = Number(xRaw);
const y = Number(yRaw);
if (
  !Number.isFinite(x) || !Number.isFinite(y) ||
  x < 0 || x > 100 || y < 0 || y > 100
) {
  console.error("❌ X and Y must be numbers between 0 and 100.");
  process.exit(1);
}

// Zoom is optional. Default 1 (no extra crop). Capped between 1 and 4.
const ZOOM_MIN = 1;
const ZOOM_MAX = 4;
let zoom = 1;
if (zoomRaw != null) {
  zoom = Number(zoomRaw);
  if (!Number.isFinite(zoom) || zoom < ZOOM_MIN || zoom > ZOOM_MAX) {
    console.error(`❌ Zoom must be a number between ${ZOOM_MIN} and ${ZOOM_MAX}.`);
    process.exit(1);
  }
}

const serviceAccount = require(SERVICE_ACCOUNT_PATH);
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

(async () => {
  try {
    await db.collection("config").doc("homepage").set(
      {
        heroImagePositionX: `${x}%`,
        heroImagePositionY: `${y}%`,
        heroImageZoom: zoom,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    const zoomNote = zoom === 1 ? "no extra zoom" : `${zoom}× zoom`;
    console.log(`✅ Hero crop set to ${x}% horizontal, ${y}% vertical, ${zoomNote}.`);
    console.log(`   Reload the app to see the change.`);
    process.exit(0);
  } catch (e) {
    console.error("❌ Failed:", e.message);
    process.exit(1);
  }
})();
