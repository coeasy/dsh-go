import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const workflow = (name: string) => readFileSync(resolve(root, '.github/workflows', name), 'utf8');

describe('authoritative deployment routing', () => {
  it('removes legacy mirrors from deployment routing', () => {
    const router = workflow('deploy-router.yml');
    expect(router).toContain('push:');
    expect(router).toContain('scripts/sync*.mjs');
    expect(router).toContain('catalog/schema-v3.json');
    expect(router).not.toContain('deploy-mirror.yml');
    expect(router).not.toContain('- mirrors');
  });

  it('keeps EdgeOne selective deployment target', () => {
    const router = workflow('deploy-router.yml');
    expect(router).toContain('- cloudflare');
    expect(router).toContain('- github-pages');
    expect(router).toContain('- edgeone');
    expect(router).toContain('WORKFLOWS="deploy-edgeone.yml"');
  });
});
