import { describe, expect, it } from 'vitest';

const { nextGraphqlPageSize } = await import('../scripts/github-discovery.mjs');
const { auditCatalogIdentity, buildAuditReport } = await import('../scripts/audit-catalog-identity.mjs');

describe('complete discovery resilience', () => {
  it('backs GraphQL page size down without going below the safe floor', () => {
    expect(nextGraphqlPageSize(100)).toBe(50);
    expect(nextGraphqlPageSize(50)).toBe(25);
    expect(nextGraphqlPageSize(25)).toBe(12);
    expect(nextGraphqlPageSize(12)).toBe(10);
    expect(nextGraphqlPageSize(10)).toBe(10);
  });
});

describe('catalog identity audit report', () => {
  it('emits a machine-readable clean report for canonical data', () => {
    const data: any = {
      meta: { updated_at: '2026-08-25T00:00:00.000Z' },
      plugins: [{
        slug: 'owner-demo',
        full_name: 'owner/demo',
        repo_name: 'demo',
        name: 'demo',
        metadata_source: 'github',
        category: 'tool',
        repo_url: 'https://github.com/owner/demo',
        install_cmd: 'dsh plugin install github:owner/demo',
        homepage: null,
        manifest_file: null,
        verified: false,
      }],
    };
    const result = auditCatalogIdentity(data);
    const report = buildAuditReport(data, result);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(report.schema_version).toBe(1);
    expect(report.catalog_updated_at).toBe('2026-08-25T00:00:00.000Z');
    expect(report.plugin_count).toBe(1);
    expect(report.error_count).toBe(0);
    expect(report.warning_count).toBe(0);
    expect(report.ok).toBe(true);
    expect(report.errors).toEqual([]);
  });

  it('accepts a verified dsh-package manifest record', () => {
    const data: any = {
      plugins: [{
        slug: 'owner-package',
        full_name: 'owner/package',
        repo_name: 'package',
        name: 'Package',
        metadata_source: 'dsh-package',
        category: 'mcp',
        repo_url: 'https://github.com/owner/package',
        install_cmd: 'dsh mcp install marketplace-package',
        homepage: null,
        manifest_file: 'dsh-package.json',
        verified: true,
        package_id: 'marketplace-package',
        package_type: 'mcp',
        package_version: '1.2.3',
      }],
    };
    expect(auditCatalogIdentity(data).errors).toEqual([]);
  });

  it('accepts historical install commands only as migration warnings', () => {
    const data: any = {
      plugins: [{
        slug: 'owner-legacy',
        full_name: 'owner/legacy',
        repo_name: 'legacy',
        name: 'legacy',
        metadata_source: 'github',
        category: 'tool',
        repo_url: 'https://github.com/owner/legacy',
        install_cmd: 'dsh plugin --profile tools add github:owner/legacy',
        homepage: null,
        manifest_file: null,
        verified: false,
      }],
    };
    const result = auditCatalogIdentity(data);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('historical install_cmd');
  });

  it('captures stale package metadata and API URLs as audit errors', () => {
    const data: any = { plugins: [{
      slug: 'ruvnet-ruflo',
      full_name: 'ruvnet/ruflo',
      repo_name: 'ruflo',
      name: 'claude-flow',
      metadata_source: 'github',
      category: 'agent',
      repo_url: 'https://api.github.com/repos/ruvnet/ruflo',
      install_cmd: 'dsh plugin install github:ruvnet/ruflo',
      manifest_file: 'package.json',
      verified: true,
    }] };
    const report = buildAuditReport(data);
    expect(report.ok).toBe(false);
    expect(report.error_count).toBeGreaterThanOrEqual(3);
    expect(report.errors.some((error: string) => error.includes('package/non-DSH manifest'))).toBe(true);
    expect(report.errors.some((error: string) => error.includes('GitHub-sourced name mismatch'))).toBe(true);
    expect(report.errors.some((error: string) => error.includes('GitHub API URL'))).toBe(true);
  });
});
