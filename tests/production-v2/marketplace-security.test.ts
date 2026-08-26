import { describe, expect, it } from 'vitest';
import { ecosystemInstallCommand, ecosystemInstallLink } from '../../marketplace/v2/install-link';
import { verifyPublisherIdentity } from '../../marketplace/v2/publisher';
import { scoreSupplyChain } from '../../marketplace/v2/security';
import type { EcosystemPackageV2 } from '../../marketplace/v2/types';

const item: EcosystemPackageV2 = {
  id: 'demo', version: '0.1.0', type: 'skill',
  source: { repo: 'coeasy/demo', commit: 'a'.repeat(40) },
  metadata: { verified: true }, permissions: ['filesystem.read'],
  publisher: { provider: 'github', id: 'coeasy', repository_ownership: 'required' },
  security: { provenance: { uri: 'https://example.test/provenance' }, signature: { identity: 'coeasy' }, sbom: { uri: 'https://example.test/sbom' }, license: 'MIT' },
};

describe('marketplace security v2', () => {
  it('verifies GitHub publisher ownership against canonical repository owner', () => {
    expect(verifyPublisherIdentity(item).verified).toBe(true);
    expect(verifyPublisherIdentity({ ...item, publisher: { provider: 'github', id: 'someone-else' } }).verified).toBe(false);
  });

  it('scores supply-chain evidence and generates install surfaces', () => {
    expect(scoreSupplyChain(item).grade).toBe('A');
    expect(ecosystemInstallCommand(item)).toBe('dsh skill install demo@0.1.0');
    expect(ecosystemInstallLink(item)).toContain('dsh://install?');
  });
});
