#!/usr/bin/env node

/**
 * Region Environment Setup Helper
 *
 * This script helps you switch between Margaret River and Tasmania environments.
 * It manages .env files for each region.
 *
 * Usage:
 *   node scripts/setup-region-env.js
 *   - Interactive: prompts you to set up region config
 *
 *   node scripts/setup-region-env.js margaret-river
 *   - Switches to Margaret River environment
 *
 *   node scripts/setup-region-env.js tasmania
 *   - Switches to Tasmania environment
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const ROOT_DIR = path.join(__dirname, '..');
const ENV_FILE = path.join(ROOT_DIR, '.env');
const ENV_MR_FILE = path.join(ROOT_DIR, '.env.margaret-river');
const ENV_TAS_FILE = path.join(ROOT_DIR, '.env.tasmania');

// ─── Helper: Create readline interface ───────────────────────────────────────

function prompt(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

// ─── Helper: Read/write env files ───────────────────────────────────────────

function readEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return null;
  return fs.readFileSync(filePath, 'utf-8');
}

function writeEnvFile(filePath, content) {
  fs.writeFileSync(filePath, content, 'utf-8');
}

function copyEnvFile(src, dst) {
  const content = readEnvFile(src);
  if (content) {
    writeEnvFile(dst, content);
    return true;
  }
  return false;
}

// ─── Switch to a region ──────────────────────────────────────────────────────

function switchToRegion(region) {
  if (region === 'margaret-river') {
    if (!fs.existsSync(ENV_MR_FILE)) {
      console.error(`❌ .env.margaret-river not found`);
      process.exit(1);
    }
    copyEnvFile(ENV_MR_FILE, ENV_FILE);
    console.log('✅ Switched to Margaret River environment');
  } else if (region === 'tasmania') {
    if (!fs.existsSync(ENV_TAS_FILE)) {
      console.error(`❌ .env.tasmania not found`);
      console.error(
        `   You need to create .env.tasmania with Tasmania Firebase credentials first`
      );
      process.exit(1);
    }
    copyEnvFile(ENV_TAS_FILE, ENV_FILE);
    console.log('✅ Switched to Tasmania environment');
  } else {
    console.error(`❌ Unknown region: ${region}`);
    console.error('   Valid regions: margaret-river, tasmania');
    process.exit(1);
  }
}

// ─── Interactive setup ───────────────────────────────────────────────────────

async function interactiveSetup() {
  console.log('\n🍷 Winery Tourism — Region Environment Setup\n');

  const currentRegion = readEnvFile(ENV_FILE) ? 'current' : 'none';
  console.log(`Current .env: ${currentRegion}\n`);

  console.log('Options:');
  console.log('  1) Switch to Margaret River');
  console.log('  2) Switch to Tasmania');
  console.log('  3) Create/Update Tasmania config');
  console.log('  4) View current config\n');

  const choice = await prompt('Enter choice (1-4): ');

  switch (choice) {
    case '1':
      switchToRegion('margaret-river');
      break;

    case '2':
      switchToRegion('tasmania');
      break;

    case '3':
      await setupTasmaniaConfig();
      break;

    case '4':
      viewCurrentConfig();
      break;

    default:
      console.log('❌ Invalid choice');
      process.exit(1);
  }
}

// ─── Setup Tasmania config interactively ─────────────────────────────────────

async function setupTasmaniaConfig() {
  console.log('\n📝 Setting up Tasmania Firebase Config\n');
  console.log('You can find these values in Firebase Console > Project Settings\n');

  const apiKey = await prompt('EXPO_PUBLIC_FIREBASE_API_KEY: ');
  const authDomain = await prompt('EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN: ');
  const projectId = await prompt('EXPO_PUBLIC_FIREBASE_PROJECT_ID: ');
  const storageBucket = await prompt('EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET: ');
  const messagingSenderId = await prompt('EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: ');
  const appId = await prompt('EXPO_PUBLIC_FIREBASE_APP_ID: ');
  const googleMapsKey = await prompt('GOOGLE_MAPS_API_KEY (same as Margaret River): ');

  const tasConfig = `EXPO_PUBLIC_FIREBASE_API_KEY=${apiKey}
EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN=${authDomain}
EXPO_PUBLIC_FIREBASE_PROJECT_ID=${projectId}
EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET=${storageBucket}
EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=${messagingSenderId}
EXPO_PUBLIC_FIREBASE_APP_ID=${appId}
GOOGLE_MAPS_API_KEY=${googleMapsKey}
`;

  writeEnvFile(ENV_TAS_FILE, tasConfig);
  console.log(`\n✅ Tasmania config saved to .env.tasmania\n`);
}

// ─── View current config ────────────────────────────────────────────────────

function viewCurrentConfig() {
  if (!fs.existsSync(ENV_FILE)) {
    console.log('\n⚠️  No .env file found\n');
    return;
  }

  const content = readEnvFile(ENV_FILE);
  console.log('\n📋 Current .env:\n');
  console.log(content);
}

// ─── Main ───────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);

if (args.length === 0) {
  interactiveSetup();
} else if (args[0] === 'margaret-river' || args[0] === 'tasmania') {
  switchToRegion(args[0]);
} else {
  console.error(`Usage: node scripts/setup-region-env.js [margaret-river|tasmania]`);
  process.exit(1);
}
