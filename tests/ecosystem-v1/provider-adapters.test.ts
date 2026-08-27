import { describe, expect, it } from 'vitest';
import { filterProviderAdapters, toProviderMarketplaceItem, type ProviderAdapterGroup } from '../../functions/_providers';

const group: ProviderAdapterGroup = {
  id: 'demo',
  name: 'Demo',
  description: 'LLM adapter',
  kind: 'llm',
  channels: { stable: '1.0.0', beta: '1.1.0-beta.1' },
  versions: [
    { id: 'demo', name: 'Demo', version: '1.0.0', kind: 'llm', capabilities: ['chat'], release_id: 'a'.repeat(64), artifact: { integrity: `sha256-${'b'.repeat(64)}`, size: 10, file_name: 'demo.tgz' } },
    { id: 'demo', name: 'Demo', version: '1.1.0-beta.1', kind: 'llm', capabilities: ['chat', 'tools'], release_id: 'c'.repeat(64), artifact: { integrity: `sha256-${'d'.repeat(64)}`, size: 12, file_name: 'demo-beta.tgz' } },
  ],
};

describe('Provider Adapter marketplace projection', () => {
  it('filters by kind, channel, capability and search', () => {
    expect(filterProviderAdapters([group], { kind: 'llm', channel: 'beta', capability: 'tools', search: 'demo' })).toHaveLength(1);
    expect(filterProviderAdapters([group], { channel: 'stable', capability: 'tools' })).toHaveLength(0);
  });

  it('projects the selected channel release', () => {
    expect(toProviderMarketplaceItem(group, 'stable')).toMatchObject({ id: 'demo', latest_version: '1.0.0', capabilities: ['chat'] });
    expect(toProviderMarketplaceItem(group, 'beta')).toMatchObject({ latest_version: '1.1.0-beta.1', capabilities: ['chat', 'tools'] });
  });
});
