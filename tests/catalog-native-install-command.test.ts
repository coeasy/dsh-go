import { describe, expect, it } from 'vitest';
import {
  makeCatalogInstallCmd,
  makeInstallCmd,
  normalizeStoredPlugin,
} from '../scripts/repository-identity.mjs';
import { auditCatalogIdentity } from '../scripts/audit-catalog-identity.mjs';

describe('catalog native package install commands', () => {
  it('uses canonical install instead of the legacy add/profile command', () => {
    expect(makeInstallCmd('owner/demo', 'tool')).toBe('dsh plugin install github:owner/demo');
    expect(makeInstallCmd('owner/demo', 'tool')).not.toContain(' add ');
    expect(makeInstallCmd('owner/demo', 'tool')).not.toContain('--profile');
  });

  it('uses the authoritative manifest package type and package id', () => {
    const mcp: any = normalizeStoredPlugin({
      full_name: 'owner/marketplace-mcp',
      name: 'Marketplace MCP',
      category: 'mcp',
      manifest_file: 'dsh-mcp.json',
      package_id: 'marketplace-mcp',
      package_type: 'mcp',
      package_version: '1.2.3',
    });
    expect(mcp.verified).toBe(true);
    expect(mcp.install_cmd).toBe('dsh mcp install marketplace-mcp');
    expect(makeCatalogInstallCmd(mcp)).toBe(mcp.install_cmd);
  });

  it('keeps the catalog identity audit aligned with typed commands', () => {
    const skill: any = normalizeStoredPlugin({
      full_name: 'owner/review-skill',
      repo_name: 'review-skill',
      name: 'Review Skill',
      category: 'skills',
      manifest_file: 'dsh-skill.json',
      package_id: 'review-skill',
      package_type: 'skill',
      package_version: '2.0.0',
    });
    const result = auditCatalogIdentity({ plugins: [skill] });
    expect(result.errors).toEqual([]);
    expect(skill.install_cmd).toBe('dsh skill install review-skill');
  });
});
