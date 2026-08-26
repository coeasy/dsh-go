import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const { readRuntimeRegistry, writeRuntimeRegistry } = await import('../../runtime/registry.mjs');

describe('Runtime Registry V3 persistence', () => {
  it('migrates schema 1/2 records and writes atomically as schema 3 with a plugin compatibility mirror', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-registry-'));
    const file = join(dir, 'runtime.json');
    await writeFile(file, JSON.stringify({
      schema_version: 1,
      plugins: [{ id: 'demo', type: 'plugin', version: '0.1.0', state: 'installed', commit: 'abc', restart_required: true }],
    }));
    const migrated = await readRuntimeRegistry(file);
    expect(migrated.schema_version).toBe(3);
    expect(migrated.packages[0].type).toBe('plugin');
    expect(migrated.plugins[0].channel).toBe('stable');
    expect(migrated.plugins[0].history.length).toBeGreaterThan(0);

    const written = await writeRuntimeRegistry(migrated, file);
    expect(written.generation).toBe(1);
    const stored = JSON.parse(await readFile(file, 'utf8'));
    expect(stored.schema_version).toBe(3);
    expect(stored.packages[0].restart_required).toBe(true);
    expect(stored.plugins[0].id).toBe('demo');
  });
});
