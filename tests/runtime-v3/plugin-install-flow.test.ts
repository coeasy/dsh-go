import { describe, expect, it } from 'vitest';
import { pluginInstall } from '../../runtime/v3/cli/plugin-install';
import { removePlugin } from '../../runtime/v3/installer/remove';

describe('runtime v3 compatibility contracts', () => {
  it('returns local Runtime Platform plans instead of fake side effects', async () => {
    const install = await pluginInstall({ id: 'demo-plugin', version: '0.1.0' });
    expect(install.installed).toBe(false);
    expect(install.planned).toBe(true);
    expect(install.requiresLocalRuntime).toBe(true);

    const removal = removePlugin('demo-plugin');
    expect(removal.removed).toBe(false);
    expect(removal.planned).toBe(true);
    expect(removal.argv).toContain('demo-plugin');
  });
});
