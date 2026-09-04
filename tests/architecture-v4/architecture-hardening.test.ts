import { afterEach, describe, expect, it } from 'vitest';
import { access, mkdtemp, readFile, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { evaluatePackagePolicy, classifyTrust } from '../../packages/policy-core/index.mjs';
import { copyCasSnapshot, hashDirectory, snapshotDirectory } from '../../runtime/cas-store.mjs';
import { runtimeAdapterContract } from '../../runtime/adapters/index.mjs';
import { createReleaseTrustSnapshot, trustRootRevision } from '../../runtime/trust-store.mjs';
import { buildRegistryV4FromDiscovery } from '../../scripts/registry-v4-source.mjs';
import { buildSearchIndexV3 } from '../../scripts/build-search-index-v3.mjs';
import { superviseMutation } from '../../runtime/supervisor.mjs';

const ENV_KEYS = ['DSH_RUNTIME_HOME', 'DSH_RUNTIME_REGISTRY', 'DSH_SUPERVISOR_LOCK', 'DSH_AUDIT_LOG'];
const savedEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = savedEnv[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe('architecture hardening contracts', () => {
  it('does not equate declared evidence or popularity with cryptographic trust', () => {
    const declared = classifyTrust({
      type: 'plugin', id: 'owner/pkg', security: { signature: { required: false }, provenance: {} }, metadata: { stars: 999999 },
      publisher: { id: 'owner', verified: true },
    });
    expect(declared.level).toBe('verified');
    expect(declared.cryptographic_signature_verified).toBe(false);

    const trusted = classifyTrust({ type: 'plugin', id: 'owner/pkg', publisher: { id: 'owner', verified: true } }, {
      verification: { cryptographic_signature_verified: true },
    });
    expect(trusted.level).toBe('trusted');
  });

  it('applies advisories only to the affected package and version', () => {
    const packageRecord = { type: 'plugin', id: 'owner/pkg', version: '1.2.0', publisher: { verified: true } };
    const unrelated = evaluatePackagePolicy({
      operation: 'install', package: packageRecord, approved: true,
      advisories: [{ package: { type: 'plugin', id: 'other/pkg' }, severity: 'critical', affected: '*' }],
    });
    expect(unrelated.decision).toBe('allow');

    const blocked = evaluatePackagePolicy({
      operation: 'install', package: packageRecord, approved: true,
      advisories: [{ package: { type: 'plugin', id: 'owner/pkg' }, severity: 'critical', affected: '^1.0.0' }],
    });
    expect(blocked.decision).toBe('deny');
    expect(blocked.reasons).toContain('critical-advisory');
  });

  it('requires confirmation for a local mutation without approval', () => {
    const decision = evaluatePackagePolicy({ operation: 'install', package: { type: 'plugin', id: 'owner/pkg', version: '1.0.0' } });
    expect(decision.decision).toBe('require-confirmation');
  });

  it('keeps mutable install metadata outside the content-addressable snapshot', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-cas-test-'));
    const source = join(root, 'source');
    const store = join(root, 'store');
    const restored = join(root, 'restored');
    await mkdir(source, { recursive: true });
    await writeFile(join(source, 'payload.txt'), 'immutable\n');
    await writeFile(join(source, '.dsh-install.json'), '{"installed_at":"first"}\n');
    const before = await hashDirectory(source);
    await writeFile(join(source, '.dsh-install.json'), '{"installed_at":"second"}\n');
    const after = await hashDirectory(source);
    expect(after.digest).toBe(before.digest);

    const snapshot = await snapshotDirectory(source, { root: store });
    await copyCasSnapshot(snapshot.digest, restored, { root: store });
    expect(await readFile(join(restored, 'payload.txt'), 'utf8')).toBe('immutable\n');
    await expect(access(join(restored, '.dsh-install.json'))).rejects.toBeTruthy();
  });

  it('registers one Runtime Adapter ABI for every package type', () => {
    const contract = runtimeAdapterContract();
    expect(Object.keys(contract).sort()).toEqual(['agent', 'mcp', 'plugin', 'skill']);
    for (const adapter of Object.values(contract)) {
      expect(adapter.abi_version).toBe(1);
      expect(adapter.methods).toEqual(['validate', 'prepare', 'bind', 'activate', 'health', 'deactivate', 'cleanup']);
    }
  });

  it('records trust-root revision and rejects revoked signer identity from trusted status', async () => {
    const base = { schema_version: 1, publishers: [{ id: 'owner', verified: true }], revoked_signers: ['sig@example.com'], accepted_issuers: ['https://issuer.example'] };
    const root = { ...base, revision: trustRootRevision(base) };
    const snapshot = await createReleaseTrustSnapshot({ publisher: { id: 'owner' } }, {
      cryptographic_signature_verified: true,
      identity: { sigstore: { identity: 'sig@example.com', issuer: 'https://issuer.example' } },
    }, { trustRoot: root });
    expect(snapshot.trusted).toBe(false);
    expect(snapshot.signer_revoked).toBe(true);
    expect(snapshot.trust_root_revision).toBe(root.revision);
  });

  it('quarantines discovery records without Manifest V2 while preserving discovery search', async () => {
    const commit = 'a'.repeat(40);
    const discovery = {
      plugins: [
        {
          id: 'owner/installable', full_name: 'owner/installable', package_type: 'plugin',
          package_id: 'owner/installable', package_version: '1.2.3', manifest_file: 'dsh-package.json', verified: true,
          snapshot_commit: commit, stars: 300, name: 'Installable', description: 'canonical package',
        },
        {
          id: 'owner/discovery', full_name: 'owner/discovery', package_type: 'plugin', package_id: 'owner/discovery',
          verified: false, stars: 500, name: 'Discovery', description: 'no manifest',
        },
      ],
    };
    const built = await buildRegistryV4FromDiscovery(discovery, { generated_at: '2026-09-04T00:00:00.000Z', concurrency: 1 });
    expect(built.registry.packages.map((item) => item.id)).toEqual(['owner/installable']);
    expect(built.candidates.counts.accepted).toBe(1);
    expect(built.candidates.counts.quarantined).toBe(1);
    const index = buildSearchIndexV3(built.registry, built.candidates);
    expect(index.installable_count).toBe(1);
    expect(index.discovery_only_count).toBe(1);
    expect(index.items.find((item) => item.id === 'owner/discovery')?.has_safe_release).toBe(false);
  });

  it('serializes mutations through Supervisor and emits redacted audit events', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-supervisor-test-'));
    const registryFile = join(root, 'state', 'runtime-v4.json');
    const auditFile = join(root, 'logs', 'audit-v1.jsonl');
    process.env.DSH_RUNTIME_HOME = root;
    process.env.DSH_RUNTIME_REGISTRY = registryFile;
    process.env.DSH_SUPERVISOR_LOCK = join(root, 'state', 'supervisor.lock');
    process.env.DSH_AUDIT_LOG = auditFile;
    const result = await superviseMutation('config-write', { source: 'test' }, async () => ({ changed: true, token: 'must-not-leak' }), {
      approved: true, registryFile, audit: { file: auditFile },
    });
    expect(result.changed).toBe(true);
    expect(result.supervisor.operation_id).toBeTruthy();
    const lines = (await readFile(auditFile, 'utf8')).trim().split('\n').map((line) => JSON.parse(line));
    expect(lines.map((item) => item.result)).toEqual(['started', 'success']);
    expect(JSON.stringify(lines)).not.toContain('must-not-leak');
  });
});
