#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

function hash(value) { return createHash('sha256').update(value).digest('hex'); }

export async function generateSbom(root = process.cwd()) {
  const base = resolve(root);
  const pkg = JSON.parse(await readFile(join(base, 'package.json'), 'utf8'));
  let lock = null;
  try { lock = JSON.parse(await readFile(join(base, 'package-lock.json'), 'utf8')); } catch { /* optional */ }
  const components = [];
  const packageEntries = lock?.packages ? Object.entries(lock.packages) : [];
  for (const [path, item] of packageEntries) {
    if (!path.startsWith('node_modules/') || !item?.version) continue;
    const name = path.slice('node_modules/'.length);
    components.push({
      type: 'library', name, version: item.version,
      purl: `pkg:npm/${encodeURIComponent(name)}@${encodeURIComponent(item.version)}`,
      hashes: item.integrity ? [{ alg: 'SHA-512', content: item.integrity.replace(/^sha512-/, '') }] : undefined,
    });
  }
  components.sort((a, b) => a.name.localeCompare(b.name));
  const serialSeed = `${pkg.name || basename(base)}@${pkg.version || '0.0.0'}:${components.map((item) => `${item.name}@${item.version}`).join('|')}`;
  const digest = hash(serialSeed);
  return {
    bomFormat: 'CycloneDX', specVersion: '1.6', version: 1,
    serialNumber: `urn:uuid:${digest.slice(0, 8)}-${digest.slice(8, 12)}-4${digest.slice(13, 16)}-a${digest.slice(17, 20)}-${digest.slice(20, 32)}`,
    metadata: { component: { type: 'application', name: pkg.name || basename(base), version: pkg.version || '0.0.0' } },
    components,
  };
}

async function main() {
  const root = process.argv[2] || process.cwd();
  const output = resolve(process.argv[3] || join(root, 'sbom.cdx.json'));
  const sbom = await generateSbom(root);
  await writeFile(output, `${JSON.stringify(sbom, null, 2)}\n`, 'utf8');
  console.log(output);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => { console.error(error.stack || error.message); process.exit(1); });
}
