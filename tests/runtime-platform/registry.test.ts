import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const { readRuntimeRegistry, writeRuntimeRegistry } = await import('../../runtime/registry.mjs');

describe('Runtime Registry V2 persistence', () => {
  it('migrates schema 1 records and writes atomically as schema 2', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-registry-'));
    const file = join(dir, 'runtime.json');
    await writeFile(file, JSON.stringify({
      schema_version: 1,
      plugins: [{ id: 'demo', type: 'plugin', version: '0.1.0', state: 'installed', commit: 'abc', restart_required: true }],
    }));
    const migrated = await readRuntimeRegistry(file);
    expect(migrated.schema_version).toBe(2);
    expect(migrated.plugins[0].channel).toBe('stable');
    expect(migrated.plugins[0].history.length).toBeGreaterThan(0);

    const written = await writeRuntimeRegistry(migrated, file);
    expect(written.generation).toBe(1);
    const stored = JSON.parse(await readFile(file, 'utf8'));
    expect(stored.schema_version).toBe(2);
    expect(stored.plugins[0].restart_required).toBe(true);
  });
});
