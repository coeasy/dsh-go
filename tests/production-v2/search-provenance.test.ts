import { describe, expect, it } from 'vitest';
import { StaticRegistrySearchProvider } from '../../marketplace/v2/search-provider';
import { requirePublishEvidence, validateSupplyChainEvidence } from '../../marketplace/v2/provenance';
import type { EcosystemPackageV2 } from '../../marketplace/v2/types';

const base: EcosystemPackageV2 = {
  id: 'alpha-skill', version: '0.1.0', type: 'skill',
  source: { repo: 'coeasy/alpha-skill', commit: 'a'.repeat(40) },
  metadata: { name: 'Alpha Skill', description: 'database helper', verified: true, stars: 100 },
  capabilities: ['database'], provides: ['sql'], permissions: [],
  publisher: { provider: 'github', id: 'coeasy' },
  security: {
    provenance: { uri: 'https://example.test/provenance', digest: 'b'.repeat(64) },
    signature: { identity: 'coeasy', bundle: 'https://example.test/signature' },
    sbom: { uri: 'https://example.test/sbom', digest: 'c'.repeat(64) },
    license: 'MIT',
  },
};

describe('search and provenance production contracts', () => {
  it('keeps static Registry search as the canonical default provider', async () => {
    const provider = new StaticRegistrySearchProvider([
      base,
      { ...base, id: 'beta-agent', type: 'agent', metadata: { name: 'Beta Agent', description: 'workflow', verified: false, stars: 5 } },
    ]);
    const result = await provider.search({ q: 'database', type: 'skill', verified: true });
    expect(result.provider).toBe('static');
    expect(result.items.map((item) => item.id)).toEqual(['alpha-skill']);
  });

  it('validates publisher release evidence without pretending to cryptographically sign it', () => {
    expect(validateSupplyChainEvidence(base).valid).toBe(true);
    expect(requirePublishEvidence(base).valid).toBe(true);
    const missing = requirePublishEvidence({ ...base, security: { license: 'MIT' } });
    expect(missing.valid).toBe(false);
    expect(missing.reasons.join(' ')).toContain('missing release evidence');
  });
});
