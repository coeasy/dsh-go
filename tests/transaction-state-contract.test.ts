import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { migrateRuntimeRegistry } from '../runtime/registry.mjs';
import { packageActivationState } from '../runtime/package-status.mjs';

describe('Transaction lifecycle persistence contract', () => {
  it('writes new transaction completions as pending-restart rather than legacy installed', async () => {
    const source = await readFile('runtime/transaction.mjs', 'utf8');
    const recordStart = source.indexOf('function installedRecord');
    const identityStart = source.indexOf('\nfunction identity', recordStart);
    expect(recordStart).toBeGreaterThanOrEqual(0);
    expect(identityStart).toBeGreaterThan(recordStart);
    const recordSource = source.slice(recordStart, identityStart);
    expect(recordSource).toContain("state: 'pending-restart'");
    expect(recordSource).not.toContain("state: 'installed'");
    expect(recordSource).toContain('restart_required: true');
    expect(recordSource).toContain('activated: false');
    expect(recordSource).toContain("'transaction-install-complete'");
  });

  it('keeps versionless semantics latest-compatible in the Transaction Core itself', async () => {
    const source = await readFile('runtime/transaction.mjs', 'utf8');
    const requestStart = source.indexOf('function requestFromEntry');
    const documentStart = source.indexOf('\nexport async function readPackagePlanDocument', requestStart);
    expect(requestStart).toBeGreaterThanOrEqual(0);
    expect(documentStart).toBeGreaterThan(requestStart);
    const requestSource = source.slice(requestStart, documentStart);
    expect(requestSource).toContain("parsePackageSpec(entry, '*', 'plugin')");
    expect(requestSource).not.toContain("parsePackageSpec(entry, '0.1.0', 'plugin')");
  });

  it('keeps legacy installed records readable while deriving the same pending activation state', () => {
    const registry = migrateRuntimeRegistry({
      schema_version: 3,
      generation: 1,
      packages: [{
        type: 'plugin', id: 'legacy-demo', version: '0.1.0', state: 'installed',
        enabled: true, activated: false, restart_required: true,
      }],
    });
    expect(registry.packages[0].state).toBe('installed');
    expect(packageActivationState(registry.packages[0])).toBe('pending-restart');
  });
});
