#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { validateRegistryV4 } from '../packages/registry-core/index.mjs';

const file = resolve(process.argv[2] || 'catalog/registry-v4.json');
const registry = validateRegistryV4(JSON.parse(await readFile(file, 'utf8')));
const releaseCount = registry.packages.reduce((sum, pkg) => sum + pkg.releases.length, 0);
console.log(`Registry V4 valid: ${registry.packages.length} packages / ${releaseCount} releases / revision ${registry.revision}`);
