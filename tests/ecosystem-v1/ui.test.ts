import { describe, expect, it } from 'vitest';
import { createInstallDialogState, markInstallActivated, markInstallExecuted, planInstallDialog } from '../../marketplace/ui/components/InstallDialog';
import { createMarketplaceDashboardState, filterMarketplaceDashboard } from '../../marketplace/ui/components/MarketplaceDashboard';
import type { MarketplaceItem } from '../../marketplace/v1/types';

function item(id: string, type: MarketplaceItem['type']): MarketplaceItem {
  return {
    id,
    name: id,
    type,
    version: '0.1.0',
    channel: 'stable',
    source: { type: 'github', url: `https://github.com/owner/${id}`, commit: '0123456789abcdef0123456789abcdef01234567' },
    capabilities: [type],
    dependencies: [],
  };
}

describe('Marketplace UI contracts', () => {
  it('keeps local install and restart activation explicit', () => {
    let state = planInstallDialog(createInstallDialogState('demo'));
    expect(state.status).toBe('planned');
    expect(state.executed).toBe(false);
    state = markInstallExecuted(state, true);
    expect(state.status).toBe('restart-required');
    state = markInstallActivated(state);
    expect(state.status).toBe('active');
    expect(state.restartRequired).toBe(false);
  });

  it('derives multi-type dashboard state from marketplace items', () => {
    const dashboard = createMarketplaceDashboardState([item('p', 'plugin'), item('m', 'mcp'), item('s', 'skill')]);
    expect(dashboard.plugins).toHaveLength(1);
    expect(dashboard.mcpServers).toHaveLength(1);
    const filtered = filterMarketplaceDashboard(dashboard, { type: 'skill' });
    expect(filtered.items.map((entry) => entry.id)).toEqual(['s']);
  });
});
