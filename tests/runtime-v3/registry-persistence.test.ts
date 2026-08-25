import { describe, expect, it } from 'vitest';
import { createRegistry, removeFromRegistry, upsertRegistry } from '../../runtime/v3/storage/persistence.js';

describe('runtime registry persistence', () => {
  it('stores and removes plugin lifecycle records', () => {
    const registry = createRegistry();
    const installed = upsertRegistry(registry, {
      id: 'demo-plugin',
      type: 'plugin',
      version: '0.1.0',
      state: 'installed',
    });

    expect(installed.items).toHaveLength(1);

    const removed = removeFromRegistry(installed, 'demo-plugin');
    expect(removed.items).toHaveLength(0);
  });
});
