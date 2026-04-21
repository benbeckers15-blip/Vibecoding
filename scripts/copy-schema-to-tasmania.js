/**
 * Schema Copy Script: Margaret River → Tasmania
 *
 * This script reads the collection structure from the Margaret River Firestore
 * and creates equivalent empty/placeholder documents in the Tasmania Firestore.
 *
 * Usage:
 *   node scripts/copy-schema-to-tasmania.js
 *
 * Prerequisites:
 *   - service-account.json (Margaret River credentials) in project root
 *   - service-account-tasmania.json (Tasmania credentials) in project root
 */

const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

// ─── Load credentials ────────────────────────────────────────────────────────

let margaretRiverApp, tasmaniaApp;
let margaretRiverDb, tasmaniaDb;

try {
  const mrServiceAccount = require('../service-account.json');
  margaretRiverApp = admin.initializeApp(
    { credential: admin.credential.cert(mrServiceAccount) },
    'margaret-river'
  );
  margaretRiverDb = admin.firestore(margaretRiverApp);
  console.log('✅ Connected to Margaret River Firestore');
} catch (err) {
  console.error('❌ Failed to load Margaret River credentials (service-account.json)');
  console.error(err.message);
  process.exit(1);
}

try {
  const tasServiceAccount = require('../service-account-tasmania.json');
  tasmaniaApp = admin.initializeApp(
    { credential: admin.credential.cert(tasServiceAccount) },
    'tasmania'
  );
  tasmaniaDb = admin.firestore(tasmaniaApp);
  console.log('✅ Connected to Tasmania Firestore');
} catch (err) {
  console.error('❌ Failed to load Tasmania credentials (service-account-tasmania.json)');
  console.error('   Please ensure service-account-tasmania.json exists in project root');
  process.exit(1);
}

// ─── Helper: Infer field type and create placeholder ────────────────────────

function createPlaceholder(value) {
  if (value === null || value === undefined) return null;

  const type = typeof value;

  if (type === 'boolean') return false;
  if (type === 'number') return 0;
  if (type === 'string') return '';
  if (Array.isArray(value)) return [];
  if (type === 'object') {
    // Check if it's a Firestore Timestamp
    if (value.toDate && typeof value.toDate === 'function') {
      return new Date();
    }
    // Recursively handle nested objects
    const placeholder = {};
    for (const [k, v] of Object.entries(value)) {
      placeholder[k] = createPlaceholder(v);
    }
    return placeholder;
  }

  return null;
}

// ─── Helper: Extract schema from a document ──────────────────────────────────

function extractSchema(data) {
  const schema = {};

  if (!data || typeof data !== 'object') return schema;

  for (const [key, value] of Object.entries(data)) {
    schema[key] = createPlaceholder(value);
  }

  return schema;
}

// ─── Main logic ──────────────────────────────────────────────────────────────

async function copySchemaToTasmania() {
  console.log('\n🚀 Starting schema copy: Margaret River → Tasmania\n');

  try {
    // Get all collections from Margaret River
    const collections = await margaretRiverDb.listCollections();
    console.log(`📦 Found ${collections.length} collections in Margaret River\n`);

    const summary = {};

    for (const collection of collections) {
      const collectionName = collection.id;
      console.log(`\n📍 Processing collection: "${collectionName}"`);

      // Get first document from this collection to extract schema
      const snapshot = await collection.limit(1).get();

      if (snapshot.empty) {
        console.log(`   ⚠️  Collection is empty, skipping...`);
        summary[collectionName] = { status: 'skipped', reason: 'empty' };
        continue;
      }

      // Extract schema from first document
      const firstDoc = snapshot.docs[0];
      const data = firstDoc.data();
      const schema = extractSchema(data);

      console.log(`   📄 Extracted schema from "${firstDoc.id}"`);

      // Get or create collection in Tasmania
      const tasmaniaCollection = tasmaniaDb.collection(collectionName);

      // Create a placeholder document with the same schema
      const placeholderId = `_placeholder_${Date.now()}`;
      await tasmaniaCollection.doc(placeholderId).set(schema);

      console.log(`   ✅ Created placeholder document: "${placeholderId}"`);
      console.log(`   📋 Fields: ${Object.keys(schema).join(', ')}`);

      summary[collectionName] = {
        status: 'created',
        documentCount: snapshot.size,
        placeholderId,
        fields: Object.keys(schema),
      };
    }

    // Print summary
    console.log('\n\n' + '='.repeat(70));
    console.log('📊 SCHEMA COPY SUMMARY');
    console.log('='.repeat(70) + '\n');

    for (const [collectionName, result] of Object.entries(summary)) {
      if (result.status === 'created') {
        console.log(`✅ ${collectionName}`);
        console.log(`   └─ Placeholder ID: ${result.placeholderId}`);
        console.log(`   └─ Fields: ${result.fields.join(', ')}\n`);
      } else if (result.status === 'skipped') {
        console.log(`⏭️  ${collectionName} (${result.reason})\n`);
      }
    }

    console.log('='.repeat(70));
    console.log('\n🎉 Schema copy complete!\n');
    console.log('Next steps:');
    console.log('  1. Delete placeholder documents from Tasmania Firestore (optional)');
    console.log('  2. Start populating Tasmania with actual winery data');
    console.log('  3. Create .env.tasmania with Tasmania Firebase credentials');
    console.log('\n');

  } catch (err) {
    console.error('\n❌ Error during schema copy:');
    console.error(err);
    process.exit(1);
  } finally {
    // Clean up
    await margaretRiverApp.delete();
    await tasmaniaApp.delete();
  }
}

// ─── Run ─────────────────────────────────────────────────────────────────────

copySchemaToTasmania().catch(console.error);
