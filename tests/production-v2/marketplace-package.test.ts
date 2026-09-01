import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { findPackageManifest, validatePackageManifest } from '../../runtime/package-manifest.mjs';

describe('first-party DSH Marketplace package layer', () => {
  it('exposes a verified remote MCP manifest with a host-scoped network permission', async () => {
    const root = JSON.parse(await readFile('dsh-package.json', 'utf8'));
    const packaged = JSON.parse(await readFile('packages/dsh-go-marketplace/dsh-package.json', 'utf8'));
    expect(root).toEqual(packaged);
    expect(validatePackageManifest(root, { file: 'dsh-package.json' })).toMatchObject({ valid: true });
    expect(root.type).toBe('mcp');
    expect(root.mcp).toMatchObject({
      transport: 'streamable-http',
      url: 'https://dsh-go.pages.dev/api/v1/mcp',
    });
    expect(root.permissions).toEqual(['network']);
    expect(root.permission_policy.network.allow).toEqual(['dsh-go.pages.dev']);
    expect(root.mcp.tools).toContain('plan_local_install');
  });

  it('keeps the package subdirectory independently discoverable and releaseable', async () => {
    const found = await findPackageManifest('packages/dsh-go-marketplace');
    expect(found?.valid).toBe(true);
    expect(found?.manifest.id).toBe('dsh-go-marketplace');
    const workflow = await readFile('.github/workflows/release-dsh-marketplace.yml', 'utf8');
    expect(workflow).toContain('package_path: packages/dsh-go-marketplace');
    expect(workflow).toContain('uses: ./.github/workflows/package-release.yml');
    const sync = await readFile('.github/workflows/sync.yml', 'utf8');
    expect(sync).toContain('packages/dsh-go-marketplace/**');
  });
});
