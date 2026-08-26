import { createHash } from 'node:crypto';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { assertSafeEvidenceUrl, verifyPackageEvidence } from '../../runtime/supply-chain-verifier.mjs';

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

  it('rejects unsafe remote evidence targets and digest mismatches', async () => {
    expect(() => assertSafeEvidenceUrl('http://example.com/provenance')).toThrow('HTTPS');
    expect(() => assertSafeEvidenceUrl('https://127.0.0.1/private')).toThrow('private or loopback');

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
});
