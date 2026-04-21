#!/usr/bin/env node
/**
 * cleanup-duplicate-wineries-tasmania.js
 *
 * Deletes duplicate winery documents from Tasmania Firestore.
 *
 * Background: When we re-uploaded with --use-slug, the old placeId-based
 * documents remained. This script removes them, keeping only the slug versions.
 *
 * Identifies documents to delete by their ID:
 *   - DELETE: IDs starting with "ChIJ" (Google Place IDs)
 *   - KEEP: IDs that are slugs (human-readable, lowercase with hyphens)
 *
 * Usage:
 *   node scripts/cleanup-duplicate-wineries-tasmania.js        # dry run (default)
 *   node scripts/cleanup-duplicate-wineries-tasmania.js --go   # actually delete
 */

const admin = require('firebase-admin');
const path = require('path');
const fs = require('fs');

// ── CONFIG ────────────────────────────────────────────────────────────────────

const DRY_RUN = !process.argv.includes('--go');

// ── Initialize Firebase ───────────────────────────────────────────────────────

const serviceAccountPath = path.join(__dirname, '../service-account-tasmania.json');

if (!fs.existsSync(serviceAccountPath)) {
  console.error('\n❌ Error: service-account-tasmania.json not found in project root');
  console.error(`   Expected at: ${serviceAccountPath}\n`);
  process.exit(1);
}

const serviceAccount = require(serviceAccountPath);
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

// ── MAIN ──────────────────────────────────────────────────────────────────────

async function cleanup() {
  console.log('\n');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('🧹 Clean Up Duplicate Tasmania Wineries');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('');

  if (DRY_RUN) {
    console.log('🔍 DRY RUN MODE — showing what would be deleted\n');
  } else {
    console.log('⚠️  LIVE MODE — actually deleting documents\n');
  }

  try {
    // Fetch all winery documents
    console.log('📋 Fetching all winery documents...');
    const snapshot = await db.collection('wineries').get();
    console.log(`✓ Found ${snapshot.size} total documents\n`);

    // Categorize documents
    const toDelete = [];
    const toKeep = [];

    snapshot.forEach((doc) => {
      const docId = doc.id;
      const data = doc.data();
      const name = data.name || '(unnamed)';

      // Google Place IDs start with "ChIJ"
      if (docId.startsWith('ChIJ')) {
        toDelete.push({ id: docId, name });
      } else {
        toKeep.push({ id: docId, name });
      }
    });

    // Summary
    console.log('📊 Documents Summary:');
    console.log(`   TO DELETE (PlaceID docs): ${toDelete.length}`);
    console.log(`   TO KEEP (slug docs):      ${toKeep.length}`);
    console.log('');

    if (toDelete.length === 0) {
      console.log('✅ No duplicates found! Database is clean.');
      console.log('');
      process.exit(0);
    }

    // Show what will be deleted
    console.log('🗑️  Documents to DELETE:');
    toDelete.forEach(({ id, name }) => {
      console.log(`   ❌ ${name}`);
      console.log(`      ID: ${id}`);
    });

    console.log('');
    console.log('✅ Documents to KEEP:');
    toKeep.slice(0, 5).forEach(({ id, name }) => {
      console.log(`   ✅ ${name}`);
      console.log(`      ID: ${id}`);
    });
    if (toKeep.length > 5) {
      console.log(`   ... and ${toKeep.length - 5} more`);
    }

    console.log('');
    console.log('═══════════════════════════════════════════════════════════════');

    if (DRY_RUN) {
      console.log(`\n🔍 DRY RUN: ${toDelete.length} documents would be deleted.`);
      console.log('\nTo actually delete, run:');
      console.log('   node scripts/cleanup-duplicate-wineries-tasmania.js --go\n');
      process.exit(0);
    }

    // Actually delete
    console.log(`\n🔄 Deleting ${toDelete.length} duplicate documents...`);
    console.log('');

    let deleted = 0;
    let failed = 0;

    for (let i = 0; i < toDelete.length; i++) {
      const { id, name } = toDelete[i];
      try {
        await db.collection('wineries').doc(id).delete();
        deleted++;
        console.log(`  ✅ Deleted: ${name}`);
      } catch (error) {
        failed++;
        console.error(`  ❌ Failed to delete ${name}: ${error.message}`);
      }
    }

    console.log('');
    console.log('═══════════════════════════════════════════════════════════════');
    console.log(`✅ Cleanup complete!`);
    console.log(`   Deleted: ${deleted}/${toDelete.length}`);
    console.log(`   Failed:  ${failed}`);
    console.log(`   Kept:    ${toKeep.length}`);
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('');
    console.log('📝 Next steps:');
    console.log('   1. Reload your Expo app (Cmd+R)');
    console.log('   2. Check that wineries list no longer has duplicates');
    console.log('   3. Click a winery to verify details display correctly');
    console.log('');

    process.exit(0);
  } catch (error) {
    console.error('\n❌ Fatal error:');
    console.error(error.message);
    console.error('');
    process.exit(1);
  }
}

cleanup();
