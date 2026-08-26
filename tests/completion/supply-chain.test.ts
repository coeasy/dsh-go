import { createHash } from 'node:crypto';
import { mkdtemp, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { installPackage } from '../../runtime/installer.mjs';
import {
  assertSafeEvidenceResolution,
  assertSafeEvidenceUrl,
  verifyEvidenceReference,
  verifyPackageEvidence,
  verifySecurityEvidence,
} from '../../runtime/supply-chain-verifier.mjs';

function digest(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

describe('supply-chain evidence verifier', () => {
  it('marks local evidence verified only after a real digest match', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-evidence-'));
    const provenance = '{"builder":"github-actions"}\n';
    const sbom = '{"bomFormat":"CycloneDX"}\n';
    await writeFile(join(root, 'provenance.json'), provenance);
    await writeFile(join(root, 'sbom.cdx.json'), sbom);
    await writeFile(join(root, 'signature.bundle'), 'opaque-signature-bundle');
    await writeFile(join(root, 'dsh-package.json'), JSON.stringify({
      manifest_version: '1.0.0', id: 'evidence-demo', name: 'Evidence Demo', version: '0.1.0', type: 'plugin',
      permissions: [], compatibility: {}, publisher: { provider: 'github', id: 'owner' },
      security: {
        license: 'MIT',
        provenance: { uri: 'provenance.json', digest: `sha256:${digest(provenance)}` },
        sbom: { uri: 'sbom.cdx.json', digest: digest(sbom) },
        signature: { bundle: 'signature.bundle', digest: digest('opaque-signature-bundle'), identity: 'owner@example.com' },
      },
      plugin: { entrypoint: 'index.mjs' },
    }));

    const result = await verifyPackageEvidence(root);
    expect(result.valid).toBe(true);
    expect(result.summary).toEqual({ declared: 3, verified: 3, failed: 0 });
    expect(result.cryptographic_signature_verified).toBe(false);
    expect(result.evidence.find((item) => item.kind === 'signature')?.reason).toContain('cryptographic signer verification still requires');
  });

  it('rejects unsafe remote evidence targets, DNS-to-private resolution, and digest mismatches', async () => {
    expect(() => assertSafeEvidenceUrl('http://example.com/provenance')).toThrow('HTTPS');
    expect(() => assertSafeEvidenceUrl('https://127.0.0.1/private')).toThrow('private, loopback');
    expect(() => assertSafeEvidenceUrl('https://localhost./private')).toThrow('localhost');
    expect(() => assertSafeEvidenceUrl('https://example.com/evidence#fragment')).toThrow('fragment');
    await expect(assertSafeEvidenceResolution('https://packages.example/evidence', {
      lookup: async () => [{ address: '10.0.0.7', family: 4 }],
    })).rejects.toThrow('resolves to a private');
    await expect(assertSafeEvidenceResolution('https://packages.example/evidence', {
      lookup: async () => [{ address: '93.184.216.34', family: 4 }],
    })).resolves.toEqual([{ address: '93.184.216.34', family: 4 }]);

    const root = await mkdtemp(join(tmpdir(), 'dsh-evidence-bad-'));
    await writeFile(join(root, 'sbom.json'), '{}');
    await writeFile(join(root, 'dsh-package.json'), JSON.stringify({
      manifest_version: '1.0.0', id: 'bad', name: 'Bad', version: '0.1.0', type: 'plugin',
      security: { sbom: { uri: 'sbom.json', digest: '0'.repeat(64) } }, plugin: { entrypoint: 'index.mjs' },
    }));
    const result = await verifyPackageEvidence(root);
    expect(result.valid).toBe(false);
    expect(result.evidence.find((item) => item.kind === 'sbom')?.status).toBe('digest-mismatch');
  });

  it('rejects local evidence that escapes the package root through a symlink', async () => {
    if (process.platform === 'win32') return;
    const root = await mkdtemp(join(tmpdir(), 'dsh-evidence-link-'));
    const outside = await mkdtemp(join(tmpdir(), 'dsh-evidence-outside-'));
    const payload = '{"outside":true}\n';
    const outsideFile = join(outside, 'sbom.json');
    await writeFile(outsideFile, payload);
    await symlink(outsideFile, join(root, 'sbom-link.json'));

    const result = await verifyEvidenceReference('sbom', {
      uri: 'sbom-link.json', digest: digest(payload),
    }, { root });
    expect(result.status).toBe('verification-error');
    expect(result.reason).toContain('through a symlink');
  });

  it('stops reading an oversized remote body even without Content-Length', async () => {
    const chunk = new Uint8Array(6 * 1024 * 1024);
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(chunk);
        controller.enqueue(chunk);
        controller.close();
      },
    });
    const result = await verifyEvidenceReference('sbom', {
      uri: 'https://packages.example/sbom', digest: '0'.repeat(64),
    }, {
      root: process.cwd(),
      online: true,
      lookup: async () => [{ address: '93.184.216.34', family: 4 }],
      fetch: async () => new Response(body, { status: 200 }),
    });
    expect(result.status).toBe('verification-error');
    expect(result.reason).toContain('evidence exceeds');
  });

  it('keeps missing evidence backward compatible but fails declared evidence integrity', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-evidence-security-'));
    await writeFile(join(root, 'proof.json'), '{"proof":1}\n');
    expect((await verifySecurityEvidence({}, { root })).valid).toBe(true);

    const report = await verifySecurityEvidence({
      provenance: { uri: 'proof.json', digest: '0'.repeat(64) },
    }, { root });
    expect(report.valid).toBe(false);
    expect(report.summary).toEqual({ declared: 1, verified: 0, failed: 1 });
  });

  it('defends the installer against direct yanked-package calls', async () => {
    await expect(installPackage({
      type: 'plugin', id: 'yanked-direct', version: '0.1.0', security: { yanked: true },
    }, { dryRun: true })).rejects.toMatchObject({ code: 'DSH_PACKAGE_YANKED' });
  });
});
