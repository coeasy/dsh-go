import { createHash } from 'node:crypto';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { verifySecurityEvidence } from '../../runtime/supply-chain-verifier.mjs';
import { verifySupplyChainIdentity } from '../../runtime/supply-chain-identity.mjs';

function digest(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

function slsaStatement() {
  return JSON.stringify({
    _type: 'https://in-toto.io/Statement/v1',
    subject: [{ name: 'package', digest: { sha256: 'a'.repeat(64) } }],
    predicateType: 'https://slsa.dev/provenance/v1',
    predicate: {
      buildDefinition: {
        buildType: 'https://github.com/Attestations/GitHubActionsWorkflow@v1',
        externalParameters: { repository: 'https://github.com/acme/demo' },
        resolvedDependencies: [{ uri: 'git+https://github.com/acme/demo.git' }],
      },
      runDetails: { builder: { id: 'https://github.com/actions/runner' } },
    },
  }) + '\n';
}

describe('supply-chain publisher identity', () => {
  it('verifies an explicitly required Sigstore identity and SLSA v1 policy', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-identity-'));
    const provenance = slsaStatement();
    const bundle = '{"mediaType":"application/vnd.dev.sigstore.bundle.v0.3+json"}\n';
    await writeFile(join(root, 'provenance.json'), provenance);
    await writeFile(join(root, 'provenance.sigstore.json'), bundle);

    const security = {
      provenance: {
        provider: 'slsa',
        uri: 'provenance.json',
        digest: digest(provenance),
        required: true,
        builder_id: 'https://github.com/actions/runner',
        build_type: 'https://github.com/Attestations/GitHubActionsWorkflow@v1',
        source_repository: 'acme/demo',
      },
      signature: {
        provider: 'sigstore',
        bundle: 'provenance.sigstore.json',
        digest: digest(bundle),
        identity: 'https://github.com/acme/demo/.github/workflows/release.yml@refs/tags/v0.1.0',
        issuer: 'https://token.actions.githubusercontent.com',
        signed: 'provenance',
        required: true,
      },
    };
    const evidence = await verifySecurityEvidence(security, { root, online: false });
    let calls = 0;
    const identity = await verifySupplyChainIdentity(security, evidence, {
      root,
      hostEnv: { PATH: process.env.PATH || '', GITHUB_TOKEN: 'must-not-leak' },
      cosignRunner: async (args: string[], context: { env: Record<string, string> }) => {
        calls += 1;
        expect(args[0]).toBe('verify-blob');
        expect(args).toContain('--certificate-identity');
        expect(args).toContain('--certificate-oidc-issuer');
        expect(context.env.GITHUB_TOKEN).toBeUndefined();
        return { stdout: 'Verified OK', stderr: '' };
      },
    });

    expect(calls).toBe(1);
    expect(identity.valid).toBe(true);
    expect(identity.cryptographic_signature_verified).toBe(true);
    expect(identity.slsa_provenance_verified).toBe(true);
    expect(identity.sigstore.status).toBe('verified');
    expect(identity.slsa.status).toBe('verified');
  });

  it('fails closed when a required Sigstore identity cannot be verified', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-identity-required-'));
    const provenance = slsaStatement();
    const bundle = '{}\n';
    await writeFile(join(root, 'provenance.json'), provenance);
    await writeFile(join(root, 'bundle.json'), bundle);
    const security = {
      provenance: { uri: 'provenance.json', digest: digest(provenance) },
      signature: {
        provider: 'sigstore', bundle: 'bundle.json', digest: digest(bundle),
        identity: 'release@example.com', issuer: 'https://accounts.example.com', signed: 'provenance', required: true,
      },
    };
    const evidence = await verifySecurityEvidence(security, { root });
    const identity = await verifySupplyChainIdentity(security, evidence, {
      root,
      cosignRunner: async () => { throw new Error('signature verification failed'); },
    });
    expect(identity.valid).toBe(false);
    expect(identity.sigstore.status).toBe('verification-failed');
  });

  it('rejects SLSA builder/source policy mismatches', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-slsa-mismatch-'));
    const provenance = slsaStatement();
    await writeFile(join(root, 'provenance.json'), provenance);
    const security = {
      provenance: {
        provider: 'slsa', uri: 'provenance.json', digest: digest(provenance), required: true,
        builder_id: 'https://example.com/untrusted-builder', source_repository: 'other/repository',
      },
    };
    const evidence = await verifySecurityEvidence(security, { root });
    const identity = await verifySupplyChainIdentity(security, evidence, { root });
    expect(identity.valid).toBe(false);
    expect(identity.slsa.status).toBe('policy-mismatch');
    expect(identity.slsa.reason).toContain('builder.id');
    expect(identity.slsa.reason).toContain('source repository');
  });

  it('keeps legacy digest-only signatures installable without claiming signer authenticity', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-identity-legacy-'));
    const bundle = 'legacy-bundle';
    await writeFile(join(root, 'bundle.bin'), bundle);
    const security = {
      signature: { bundle: 'bundle.bin', digest: digest(bundle), identity: 'legacy@example.com' },
    };
    const evidence = await verifySecurityEvidence(security, { root });
    const identity = await verifySupplyChainIdentity(security, evidence, { root });
    expect(identity.valid).toBe(true);
    expect(identity.cryptographic_signature_verified).toBe(false);
    expect(identity.sigstore.status).toBe('identity-policy-incomplete');
  });
});
