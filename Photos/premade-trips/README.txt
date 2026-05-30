Pre-made trip thumbnails
========================

Drop image files in this folder, then run:

    node scripts/upload-premade-trip-thumbnails-tasmania.js

The uploader matches each file (basename, sans extension) to a doc in
the `premade_trips` Firestore collection — first by exact doc id, then
by slugified `title`.

Supported extensions: .jpg .jpeg .png .webp .gif

Naming examples
---------------
    abc123XYZ.jpg                 ← matches doc id `abc123XYZ`
    half-day-classic.jpg          ← matches title "Half-Day Classic"
    biodynamic-organic.webp       ← matches title "Biodynamic & Organic"
    long-lunch-edition.png        ← matches title "Long-Lunch Edition"

Recommended image specs
-----------------------
You don't need to crop or resize anything yourself — the uploader auto-
crops every photo to a 16:10 landscape thumbnail and caps the long edge
at 1600px before sending it to the bucket. Just drop in whatever you've
got.

Portrait phone photos are handled by taking 65% off the bottom and 35%
off the top, which keeps the subject (faces, buildings, vineyard
horizons) in frame. If a particular photo doesn't crop well, the easy
fix is to crop it yourself first so the subject is centred.

Output is always JPEG, quality 85 — good-looking, small file, fast load.

Single-file upload
------------------
If a filename doesn't match a doc, pass both args explicitly:

    node scripts/upload-premade-trip-thumbnails-tasmania.js \
      Photos/premade-trips/mything.jpg <tripDocId>

Dry-run (no upload, no Firestore write)
---------------------------------------
    node scripts/upload-premade-trip-thumbnails-tasmania.js --dry-run

This folder is git-ignored where appropriate — do not commit large
binaries unless they're intentional source-of-truth originals.
