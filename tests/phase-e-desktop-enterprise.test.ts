import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const policyModule = await import('../runtime/enterprise-policy.mjs');
const desktopModule = await import('../runtime/desktop-center.mjs');
const manifestModule = await import('../runtime/package-manifest.mjs');
const pluginModule = await import('../packages/dsh-go-marketplace-plugin/index.mjs');
const installerModule = await import('../runtime/installer.mjs');
const checksumModule = await import('../scripts/checksum.mjs');

describe('Phase E desktop and enterprise platform', () => {
  it('fails closed for blocked publishers and permissions when enterprise enforcement is enabled', async () => {
    const policy = policyModule.normalizeEnterprisePolicy({
      schema_version: 1,
      organization: 'acme',
      enforce: true,
      publishers: { allow: ['trusted-org'], deny: [] },
      permissions: { blocked: ['shell'], require_approval: ['network'] },
    });
    const blocked = await policyModule.evaluateEnterprisePolicy(policy, {
      organization: 'acme',
      package: { type: 'plugin', id: 'unsafe', publisher: { id: 'other-org' }, permissions: ['shell'] },
      approved: true,
    });
    expect(blocked.allowed).toBe(false);
    expect(blocked.code).toBe('DSH_ENTERPRISE_POLICY_BLOCKED');
    expect(blocked.violations.join(' ')).toContain('publisher');
    expect(blocked.violations.join(' ')).toContain('shell');
  });

  it('can require organization approval without granting remote mutation authority', async () => {
    const policy = policyModule.normalizeEnterprisePolicy({
      schema_version: 1,
      enforce: true,
      permissions: { require_approval: ['network'] },
    });
    const waiting = await policyModule.evaluateEnterprisePolicy(policy, {
      package: { type: 'mcp', id: 'catalog', permissions: ['network'] },
      approved: false,
    });
    expect(waiting.allowed).toBe(false);
    expect(waiting.code).toBe('DSH_ENTERPRISE_APPROVAL_REQUIRED');
    const approved = await policyModule.evaluateEnterprisePolicy(policy, {
      package: { type: 'mcp', id: 'catalog', permissions: ['network'] },
      approved: true,
    });
    expect(approved.allowed).toBe(true);
  });

  it('enforces enterprise policy at the authoritative installer boundary used by deep links and dependencies', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-installer-policy-'));
    const policyFile = join(root, 'policy.json');
    await writeFile(policyFile, JSON.stringify({
      schema_version: 1,
      enforce: true,
      packages: { deny: ['plugin:blocked-desktop-package'] },
    }));
    const previous = process.env.DSH_ENTERPRISE_POLICY_FILE;
    process.env.DSH_ENTERPRISE_POLICY_FILE = policyFile;
    const source = { provider: 'github', repo: 'coeasy/dsh-go', commit: 'a'.repeat(40) };
    const pkg = {
      type: 'plugin',
      id: 'blocked-desktop-package',
      version: '0.1.0',
      repo: source.repo,
      commit: source.commit,
      source,
      integrity: checksumModule.artifactIntegrity({ version: '0.1.0', source }),
      artifact: { kind: 'git-source' },
      permissions: [],
      dependencies: [],
      compatibility: {},
      publisher: { id: 'coeasy' },
      security: {},
    };
    try {
      await expect(installerModule.installPackage(pkg, { dryRun: true, releaseDiscovery: false })).rejects.toMatchObject({ code: 'DSH_ENTERPRISE_POLICY_BLOCKED' });
    } finally {
      if (previous === undefined) delete process.env.DSH_ENTERPRISE_POLICY_FILE;
      else process.env.DSH_ENTERPRISE_POLICY_FILE = previous;
    }
  });

  it('builds a desktop status center with pending restart as an explicit host-owned state', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-phase-e-'));
    const runtimeRegistry = join(root, 'runtime.json');
    const policyFile = join(root, 'policy.json');
    await writeFile(runtimeRegistry, JSON.stringify({
      schema_version: 3,
      generation: 9,
      packages: [{
        type: 'plugin',
        id: 'desktop-fixture',
        version: '0.1.0',
        state: 'pending-restart',
        enabled: true,
        activated: false,
        restart_required: true,
        permissions: [],
        dependencies: [],
        security: { advisories: [] },
      }],
    }));
    const center = await desktopModule.buildDesktopCenter({ runtimeRegistry, catalog: join(root, 'missing-catalog.json'), enterprisePolicyFile: policyFile });
    expect(center.counts.pending_restart).toBe(1);
    expect(center.restart_required).toBe(true);
    expect(center.auto_restart).toBe(false);
    expect(center.contract.restart.package_manager_may_restart_host).toBe(false);
  });

  it('keeps desktop install execution behind explicit local approval', async () => {
    let requests = 0;
    const client = pluginModule.createMarketplaceDesktopClient({
      token: 'local-token',
      fetchImpl: async () => {
        requests += 1;
        return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } });
      },
    });
    const pending = await client.install({ type: 'plugin', id: 'example' });
    expect(pending.confirmation_required).toBe(true);
    expect(pending.executed).toBe(false);
    expect(pending.auto_restart).toBe(false);
    expect(requests).toBe(0);
    expect(client.restartIntent()).toMatchObject({ delegated_to_host: true, auto_restart: false, event: 'dsh:restart-requested' });
  });

  it('ships the desktop marketplace as a valid installable DSH plugin with a dedicated release workflow', async () => {
    const manifest = JSON.parse(await readFile('packages/dsh-go-marketplace-plugin/dsh-package.json', 'utf8'));
    const validated = manifestModule.validatePackageManifest(manifest, { file: 'dsh-package.json' });
    expect(validated.valid).toBe(true);
    expect(validated.manifest?.type).toBe('plugin');
    expect(validated.manifest?.id).toBe('dsh-go-marketplace-plugin');
    const workflow = await readFile('.github/workflows/release-dsh-marketplace-plugin.yml', 'utf8');
    expect(workflow).toContain('package_path: packages/dsh-go-marketplace-plugin');
    expect(workflow).toContain('package-release.yml');
  });
});
