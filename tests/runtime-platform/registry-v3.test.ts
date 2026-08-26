import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const {
  getRuntimePackage,
  migrateRuntimeRegistry,
  readRuntimeRegistry,
  upsertRuntimePackage,
  writeRuntimeRegistry,
} = await import('../../runtime/registry.mjs');

describe('Runtime Registry schema 3', () => {
  it('migrates schema 1/2 plugins into canonical packages', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-registry-v3-'));
    const file = join(dir, 'runtime.json');
    await writeFile(file, JSON.stringify({
      schema_version: 2,
      generation: 4,
      plugins: [{ id: 'demo', type: 'plugin', version: '0.1.0', state: 'installed', commit: 'abc', restart_required: true }],
    }));

    const migrated = await readRuntimeRegistry(file);
    expect(migrated.schema_version).toBe(3);
    expect(migrated.packages).toHaveLength(1);
    expect(migrated.plugins).toHaveLength(1);
    expect(migrated.packages[0].type).toBe('plugin');

    const withMcp = upsertRuntimePackage(migrated, {
      id: 'demo', type: 'mcp', version: '1.0.0', state: 'installed', commit: 'def', restart_required: true,
    });
    const written = await writeRuntimeRegistry(withMcp, file);
    expect(written.generation).toBe(5);
    expect(written.packages).toHaveLength(2);
    expect(getRuntimePackage(written, 'plugin', 'demo')?.commit).toBe('abc');
    expect(getRuntimePackage(written, 'mcp', 'demo')?.commit).toBe('def');

    const stored = JSON.parse(await readFile(file, 'utf8'));
    expect(stored.schema_version).toBe(3);
    expect(stored.packages).toHaveLength(2);
    expect(stored.plugins).toHaveLength(1);
  });

  it('rejects duplicate type+id while allowing the same id across types', () => {
    expect(() => migrateRuntimeRegistry({
      schema_version: 3,
      packages: [
        { id: 'same', type: 'plugin', version: '1.0.0', state: 'installed' },
        { id: 'same', type: 'mcp', version: '1.0.0', state: 'installed' },
      ],
    })).not.toThrow();

    expect(() => migrateRuntimeRegistry({
      schema_version: 3,
      packages: [
        { id: 'same', type: 'skill', version: '1.0.0', state: 'installed' },
        { id: 'same', type: 'skill', version: '2.0.0', state: 'installed' },
      ],
    })).toThrow(/duplicate runtime package/);
  });
});
