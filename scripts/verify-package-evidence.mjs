#!/usr/bin/env node
import { resolve } from 'node:path';
import { verifyPackageEvidence } from '../runtime/supply-chain-verifier.mjs';

const args = process.argv.slice(2);
const root = resolve(args.find((value) => !value.startsWith('--')) || process.cwd());
const result = await verifyPackageEvidence(root, { online: args.includes('--online') });
console.log(JSON.stringify(result, null, 2));
if (!result.valid) process.exitCode = 1;
