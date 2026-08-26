#!/usr/bin/env node
import { access, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { DSH_API_VERSION, DSH_PLATFORM_VERSION, DSH_RUNTIME_VERSION } from '../runtime/version.mjs';

const EXPECTED_VERSION = '0.1.0';
const EXPECTED_API = 'v1';
const errors = [];

async function json(path) {
  return JSON.parse(await readFile(resolve(path), 'utf8'));
}

function expect(label, actual, expected) {
  if (actual !== expected) errors.push(`${label}: expected ${expected}, got ${actual}`);
}

const rootPackage = await json('package.json');
const rootLock = await json('package-lock.json');
const sitePackage = await json('site/package.json');
const siteLock = await json('site/package-lock.json');
expect('package.json version', rootPackage.version, EXPECTED_VERSION);
expect('package-lock.json version', rootLock.version, EXPECTED_VERSION);
expect('package-lock.json root package version', rootLock.packages?.['']?.version, EXPECTED_VERSION);
expect('site/package.json version', sitePackage.version, EXPECTED_VERSION);
expect('site/package-lock.json version', siteLock.version, EXPECTED_VERSION);
expect('site/package-lock.json root package version', siteLock.packages?.['']?.version, EXPECTED_VERSION);
expect('DSH platform version', DSH_PLATFORM_VERSION, EXPECTED_VERSION);
expect('DSH runtime version', DSH_RUNTIME_VERSION, EXPECTED_VERSION);
expect('DSH API version', DSH_API_VERSION, EXPECTED_API);

// Public navigation/UI must not link to a newer route family. Development docs may
// mention retired routes while explaining migrations, so they are intentionally not
// treated as executable/public navigation surfaces here.
for (const path of [
  'README.md',
  'site/src/pages/ecosystem.astro',
  'site/src/pages/docs.astro',
  'site/src/pages/profiles.astro',
]) {
  const text = await readFile(resolve(path), 'utf8');
  if (text.includes('/api/v2/')) errors.push(`${path}: public UI/README must not advertise /api/v2 routes`);
}

try {
  await access(resolve('functions/api/v2/search.ts'));
  errors.push('functions/api/v2/search.ts must not exist; unified search stays on /api/v1/search');
} catch (error) {
  if (error?.code !== 'ENOENT') throw error;
}

const mcpEndpoint = await readFile(resolve('functions/api/v1/mcp.ts'), 'utf8');
if (!mcpEndpoint.includes("version: '0.1.0'")) errors.push('functions/api/v1/mcp.ts must report serverInfo version 0.1.0');
const metaEndpoint = await readFile(resolve('functions/api/v1/meta.ts'), 'utf8');
if (!metaEndpoint.includes("api_version: 'v1'")) errors.push('functions/api/v1/meta.ts must report api_version v1');

if (errors.length) {
  console.error('DSH compatibility contract failed:');
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}
console.log('DSH compatibility contract passed: product/runtime/package locks 0.1.0, canonical remote API /api/v1.');
