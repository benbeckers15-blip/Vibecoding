#!/usr/bin/env node
/**
 * Upload Pre-Made Trip Thumbnails — Tasmania (winery-tourism-tasmania)
 *
 * Uploads local thumbnail images for the curated `premade_trips` collection
 * to Firebase Cloud Storage, marks them publicly readable, and writes the
 * resulting URL into each trip's `heroImage` field on Firestore.
 *
 * Mirrors the upload pattern in `upload-hero-image-tasmania.js` (single
 * object made public via IAM, cache-busted URL stored in Firestore so RN's
 * <Image> cache and Google's edge CDN both treat a re-upload as fresh).
 *
 * ─── Two usage modes ────────────────────────────────────────────────────────
 *
 *  1. BATCH MODE (default) — scan a folder of images, upload each one, and
 *     match it to a premade_trips doc.
 *
 *       node scripts/upload-premade-trip-thumbnails-tasmania.js
 *       node scripts/upload-premade-trip-thumbnails-tasmania.js --dry-run
 *       node scripts/upload-premade-trip-thumbnails-tasmania.js --dir=Photos/premade-trips
 *
 *     The folder defaults to `Photos/premade-trips/` in the project root.
 *     Each file's basename (sans extension) is matched against:
 *       (a) the Firestore document id of a premade_trips doc, then
 *       (b) the slugified `title` of a premade_trips doc.
 *
 *     Example layout:
 *       Photos/premade-trips/
 *         abc123XYZ.jpg               ← matches doc id `abc123XYZ`
 *         half-day-classic.jpg        ← matches doc with title "Half-Day Classic"
 *         long-lunch-edition.webp     ← matches doc with title "Long-Lunch Edition"
 *
 *  2. SINGLE-FILE MODE — explicit one-off upload to one specific doc.
 *
 *       node scripts/upload-premade-trip-thumbnails-tasmania.js \
 *         <imagePath> <tripDocId>
 *
 *     Use this when the filename doesn't conveniently match the doc id or
 *     title, or when you want to overwrite a single trip's thumbnail.
 *
 * ─── Why we ignore Firebase Storage Security Rules ──────────────────────────
 * `makePublic()` grants IAM-level public read on a single object. The direct
 * Cloud Storage URL we store (`https://storage.googleapis.com/<bucket>/<path>`)
 * is governed by IAM, not by Firebase Storage rules — so the default
 * `allow read: if false` posture stays intact while these specific thumbnails
 * remain reachable.
 */

const admin = require("firebase-admin");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
// jimp-compact is already a transitive dependency of Expo, so we get image
// processing for free without adding a native module (sharp) to the project.
// Pure-JS so it works in CI / any Node version without binary builds.
const Jimp = require("jimp-compact");

// ─── Config ─────────────────────────────────────────────────────────────────

const PROJECT_ROOT = path.join(__dirname, "..");
const SERVICE_ACCOUNT_PATH = path.join(PROJECT_ROOT, "service-account-tasmania.json");
const STORAGE_BUCKET = "winery-tourism-tasmania.firebasestorage.app";

// Default folder scanned in batch mode. Lives in Photos/ alongside the
// existing hero images so it's discoverable next to its sibling assets.
const DEFAULT_PHOTO_DIR = path.join(PROJECT_ROOT, "Photos", "premade-trips");

// Storage prefix — keeps trip thumbnails namespaced separately from
// `hero-images/` (the home hero) and any other future image folders.
const STORAGE_PREFIX = "premade-trips";

const SUPPORTED_EXTS = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif"]);

// ─── Thumbnail target ───────────────────────────────────────────────────────
//
// Trip cards on the home rail are wider than they are tall. To stop the
// client-side `contentFit="cover"` from zooming into portrait source photos,
// we normalise every uploaded thumbnail to a fixed landscape aspect ratio
// before it ever hits Cloud Storage.
//
// Aspect ratio is 16:10 — close enough to the actual card dimensions
// (half-day ≈ 260×180, full-day ≈ 327×240) that the client renderer barely
// has to crop. We also cap the long edge at 1600px: bigger files just cost
// bandwidth without visible benefit on a phone screen.

const TARGET_ASPECT_W = 16;
const TARGET_ASPECT_H = 10;
const TARGET_MAX_WIDTH = 1600;
const OUTPUT_QUALITY = 85; // JPEG quality 0–100. 85 is the standard "looks good, files small" sweet spot.

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Slugify a trip title into a filename-safe identifier. Mirrors the same
 * lowercase-with-dashes convention used elsewhere in the app (winery slugs,
 * route paths, etc.) so a curator can pre-name their image files predictably.
 *
 *   "Half-Day Classic"      → "half-day-classic"
 *   "Biodynamic & Organic"  → "biodynamic-organic"
 *   "Long-Lunch Edition"    → "long-lunch-edition"
 */
function slugify(s) {
  return String(s)
    .toLowerCase()
    .replace(/&/g, " ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function inferContentType(filename) {
  const ext = path.extname(filename).toLowerCase();
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  if (ext === ".gif") return "image/gif";
  return "application/octet-stream";
}

function parseArgs(argv) {
  const args = { flags: {}, positional: [] };
  for (const raw of argv) {
    if (raw.startsWith("--")) {
      const [k, v] = raw.slice(2).split("=");
      args.flags[k] = v === undefined ? true : v;
    } else {
      args.positional.push(raw);
    }
  }
  return args;
}

// ─── Pre-flight ─────────────────────────────────────────────────────────────

if (!fs.existsSync(SERVICE_ACCOUNT_PATH)) {
  console.error(`❌ service-account-tasmania.json not found at ${SERVICE_ACCOUNT_PATH}`);
  process.exit(1);
}

const serviceAccount = require(SERVICE_ACCOUNT_PATH);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  storageBucket: STORAGE_BUCKET,
});

const db = admin.firestore();
const bucket = admin.storage().bucket();

// ─── Large-image escape hatch ───────────────────────────────────────────────
//
// jimp-compact bundles jpeg-js with a 256 MB pixel-memory cap. A 48 MP phone
// photo decodes to ~192 MB; a 100 MP photo to ~400 MB and blows that cap.
// When that happens, we shrink the source first using the system's `sips`
// tool (built into macOS — no install) and then hand the smaller version
// back to Jimp.
//
// 3000 px on the long edge is plenty of headroom for a 1600 px output and
// keeps the decoded pixel buffer well under the cap (3000 × ~2000 × 4 B
// ≈ 24 MB).

const PRESHRINK_LONG_EDGE = 3000;

/**
 * Use the macOS `sips` (Scriptable Image Processing System) tool to resize
 * a huge image down to PRESHRINK_LONG_EDGE on its long edge, written into a
 * temp file. Returns the temp file path. Caller is responsible for deleting.
 *
 * Throws if sips isn't available (i.e. not macOS). In that case the upstream
 * caller will surface a clear error telling the user to manually resize.
 */
function preshrinkWithSips(sourcePath) {
  const tmpName = `siplocal-preshrink-${Date.now()}-${path.basename(sourcePath)}.jpg`;
  const tmpPath = path.join(os.tmpdir(), tmpName);
  // -Z resizes proportionally so the LONG edge becomes the given value.
  // -s format jpeg forces JPEG output (in case source was HEIC, PNG, etc.).
  execFileSync(
    "sips",
    [
      "-Z", String(PRESHRINK_LONG_EDGE),
      "-s", "format", "jpeg",
      sourcePath,
      "--out", tmpPath,
    ],
    { stdio: ["ignore", "ignore", "pipe"] }
  );
  return tmpPath;
}

// ─── Image processor ────────────────────────────────────────────────────────

/**
 * Crop a source image (any aspect ratio) to a fixed landscape thumbnail.
 *
 * Algorithm:
 *   1. Load the file.
 *   2. Decide whether to crop horizontally or vertically based on whether
 *      the source is wider or taller than the target ratio.
 *      • Source wider than target → crop equal slices off LEFT + RIGHT.
 *      • Source taller than target → crop more off the BOTTOM than the TOP
 *        (35/65 split). Faces / horizons / cellar-door buildings almost
 *        always sit in the top half of a vertical photo, so a centred crop
 *        would chop heads off. A top-biased crop keeps the subject.
 *   3. Resize so the long edge is at most TARGET_MAX_WIDTH.
 *   4. Re-encode as JPEG at OUTPUT_QUALITY.
 *
 * Returns a Buffer containing the processed JPEG bytes.
 */
async function processImage(sourcePath) {
  const targetRatio = TARGET_ASPECT_W / TARGET_ASPECT_H; // e.g. 1.6

  // Try the source directly first. If jimp-compact's bundled JPEG decoder
  // refuses on memory grounds (very high-res phone photo), fall back to a
  // sips pre-shrink and re-try with the smaller temp file.
  let img;
  let tempFile = null;
  try {
    img = await Jimp.read(sourcePath);
  } catch (err) {
    const msg = String(err && err.message || err);
    const isMemoryError = msg.includes("maxMemoryUsageInMB");
    if (!isMemoryError) throw err;

    console.log(
      `     ⚠️  source too large for in-memory decode — pre-shrinking via \`sips\``
    );
    try {
      tempFile = preshrinkWithSips(sourcePath);
    } catch (sipsErr) {
      throw new Error(
        `Image is too large for jimp-compact to decode (${msg.trim()}).\n` +
        `Tried to pre-shrink with macOS \`sips\` but that failed too: ${sipsErr.message}\n` +
        `Workaround: open the photo in Preview and export it at a smaller size, then re-run.`
      );
    }
    img = await Jimp.read(tempFile);
  }

  const srcW = img.bitmap.width;
  const srcH = img.bitmap.height;
  const srcRatio = srcW / srcH;

  let cropW;
  let cropH;
  let cropX;
  let cropY;

  if (srcRatio > targetRatio) {
    // Source is wider than the target — crop slices off the left and right,
    // keep full height.
    cropH = srcH;
    cropW = Math.round(srcH * targetRatio);
    cropX = Math.round((srcW - cropW) / 2);
    cropY = 0;
  } else {
    // Source is taller (or equal) — crop top + bottom. Bias toward the top
    // by taking only 35% off the top vs 65% off the bottom of the surplus.
    // For a portrait phone photo this preserves the subject.
    cropW = srcW;
    cropH = Math.round(srcW / targetRatio);
    cropX = 0;
    const surplus = srcH - cropH;
    cropY = Math.round(surplus * 0.35);
  }

  img.crop(cropX, cropY, cropW, cropH);

  // Downscale if the cropped image is bigger than we need on a phone screen.
  if (cropW > TARGET_MAX_WIDTH) {
    img.resize(TARGET_MAX_WIDTH, Jimp.AUTO);
  }

  img.quality(OUTPUT_QUALITY);

  // Always emit JPEG. PNG/WEBP sources get re-encoded; that's fine for
  // photographic content (PNG would be unnecessarily large).
  const outBuf = await img.getBufferAsync(Jimp.MIME_JPEG);

  // Clean up the sips-produced temp file if we made one.
  if (tempFile) {
    try { fs.unlinkSync(tempFile); } catch { /* best-effort */ }
  }

  return {
    buffer: outBuf,
    srcW,
    srcH,
    outW: img.bitmap.width,
    outH: img.bitmap.height,
  };
}

// ─── Core upload op ─────────────────────────────────────────────────────────

/**
 * Upload one local image to Cloud Storage, mark it public, and write a
 * cache-busted URL to the named `premade_trips` doc. Returns the URL.
 *
 * `destBasename` is the leaf object name in the bucket — typically the trip
 * doc id, so re-uploading for the same trip overwrites the same object
 * (and the `?v=<ts>` cache-bust forces clients to re-fetch).
 */
async function uploadAndLink({ tripId, sourcePath, destBasename, dryRun }) {
  // Always emit .jpg after processing, regardless of source extension. The
  // processor re-encodes to JPEG so the bucket object name should match.
  const objectName = `${STORAGE_PREFIX}/${destBasename}.jpg`;

  console.log(`📸 ${path.basename(sourcePath)}`);
  console.log(`     → trip:    ${tripId}`);
  console.log(`     → object:  gs://${STORAGE_BUCKET}/${objectName}`);

  // Process even in dry-run so the user can see the crop math before
  // committing. The dry-run skips the bucket + Firestore writes only.
  const { buffer, srcW, srcH, outW, outH } = await processImage(sourcePath);
  console.log(
    `     → crop:    ${srcW}×${srcH}  →  ${outW}×${outH} ` +
    `(${TARGET_ASPECT_W}:${TARGET_ASPECT_H}, JPEG q${OUTPUT_QUALITY})`
  );

  if (dryRun) {
    console.log(`     ⏭  dry-run, skipping upload + Firestore write\n`);
    return null;
  }

  const file = bucket.file(objectName);

  await file.save(buffer, {
    metadata: {
      contentType: "image/jpeg",
      cacheControl: "public, max-age=86400",
    },
  });
  await file.makePublic();

  const url =
    `https://storage.googleapis.com/${STORAGE_BUCKET}/${objectName}?v=${Date.now()}`;

  await db.collection("premade_trips").doc(tripId).set(
    {
      heroImage: url,
      heroImageUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  console.log(`     ✅ ${url}\n`);
  return url;
}

// ─── Mode: single-file ──────────────────────────────────────────────────────

async function runSingle(sourceArg, tripId, { dryRun }) {
  const sourcePath = path.isAbsolute(sourceArg)
    ? sourceArg
    : path.join(PROJECT_ROOT, sourceArg);

  if (!fs.existsSync(sourcePath)) {
    console.error(`❌ Source image not found: ${sourcePath}`);
    process.exit(1);
  }

  // Confirm the doc exists so we don't silently create an orphan record.
  const docSnap = await db.collection("premade_trips").doc(tripId).get();
  if (!docSnap.exists) {
    console.error(`❌ No premade_trips doc with id "${tripId}".`);
    process.exit(1);
  }

  await uploadAndLink({
    tripId,
    sourcePath,
    destBasename: tripId,
    dryRun,
  });

  console.log(`🎉 Done.`);
  process.exit(0);
}

// ─── Mode: batch (scan folder) ──────────────────────────────────────────────

async function runBatch(photoDir, { dryRun }) {
  if (!fs.existsSync(photoDir)) {
    console.error(`❌ Photo folder not found: ${photoDir}`);
    console.error(
      `   Create it and drop in image files named after each trip's doc id\n` +
      `   or slugified title, e.g. "half-day-classic.jpg".`
    );
    process.exit(1);
  }

  const files = fs
    .readdirSync(photoDir)
    .filter((f) => SUPPORTED_EXTS.has(path.extname(f).toLowerCase()))
    .sort();

  if (files.length === 0) {
    console.error(`❌ No image files in ${photoDir}.`);
    console.error(`   Supported: ${[...SUPPORTED_EXTS].join(", ")}`);
    process.exit(1);
  }

  console.log(`📂 Scanning ${photoDir}`);
  console.log(`   Found ${files.length} image file(s).\n`);

  // Load the whole collection once — small enough that one read is fine
  // (and far simpler than per-file lookups).
  const tripsSnap = await db.collection("premade_trips").get();
  if (tripsSnap.empty) {
    console.error(`❌ The premade_trips collection is empty — seed it first.`);
    process.exit(1);
  }

  const tripsById = new Map();
  const tripsBySlug = new Map();
  tripsSnap.docs.forEach((d) => {
    const data = d.data();
    tripsById.set(d.id, data);
    if (data.title) tripsBySlug.set(slugify(data.title), { id: d.id, data });
  });

  console.log(`🍷 Loaded ${tripsSnap.size} premade_trips docs.\n`);

  let matched = 0;
  let skipped = 0;
  const unmatched = [];

  for (const file of files) {
    const basename = path.basename(file, path.extname(file));
    const sourcePath = path.join(photoDir, file);

    // (a) try exact doc id match
    let tripId = tripsById.has(basename) ? basename : null;

    // (b) fall back to slugified title
    if (!tripId) {
      const bySlug = tripsBySlug.get(slugify(basename));
      if (bySlug) tripId = bySlug.id;
    }

    if (!tripId) {
      unmatched.push(file);
      skipped++;
      continue;
    }

    await uploadAndLink({
      tripId,
      sourcePath,
      destBasename: tripId,
      dryRun,
    });
    matched++;
  }

  console.log(`─────────────────────────────────────────`);
  console.log(`✅ Uploaded:   ${matched}`);
  console.log(`⏭  Skipped:    ${skipped}`);
  if (unmatched.length) {
    console.log(`\n⚠️  Could not match these files to a premade_trips doc:`);
    unmatched.forEach((f) => console.log(`   • ${f}`));
    console.log(`\n   Rename them to either the doc id or the slugified title.`);
    console.log(`   Known docs:`);
    tripsSnap.docs.forEach((d) => {
      const t = d.data().title ?? "(no title)";
      console.log(`     ${d.id}   "${t}"   → ${slugify(t)}`);
    });
  }
  process.exit(0);
}

// ─── Entry ──────────────────────────────────────────────────────────────────

(async () => {
  try {
    const argv = process.argv.slice(2);
    const args = parseArgs(argv);
    const dryRun = Boolean(args.flags["dry-run"]);

    if (args.positional.length === 2) {
      // single-file mode: <imagePath> <tripDocId>
      const [sourceArg, tripId] = args.positional;
      await runSingle(sourceArg, tripId, { dryRun });
      return;
    }

    if (args.positional.length === 1) {
      console.error(
        `❌ Single-file mode needs both an image path AND a trip doc id:\n` +
        `   node scripts/upload-premade-trip-thumbnails-tasmania.js <imagePath> <tripDocId>\n`
      );
      process.exit(1);
    }

    const photoDir = args.flags.dir
      ? path.isAbsolute(args.flags.dir)
        ? args.flags.dir
        : path.join(PROJECT_ROOT, args.flags.dir)
      : DEFAULT_PHOTO_DIR;

    await runBatch(photoDir, { dryRun });
  } catch (e) {
    console.error("❌ Failed:", e.message);
    process.exit(1);
  }
})();
