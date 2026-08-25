import { describe, expect, it } from 'vitest';
import { createRuntimeRegistry, removeRuntimePackage, upsertRuntimePackage } from '../../runtime/v3/storage/runtime-persistence';

describe('runtime installer lifecycle', () => {
  it('persists install and remove lifecycle state', () => {
    const registry = createRuntimeRegistry();

    const installed = upsertRuntimePackage(registry, {
      id: 'demo-plugin',
      type: 'plugin',
      version: '0.1.0',
      state: 'installed',
    });

    expect(installed.packages).toHaveLength(1);

    const removed = removeRuntimePackage(installed, 'demo-plugin');
    expect(removed.packages).toHaveLength(0);
  });
});
