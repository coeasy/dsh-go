import type { EcosystemPackageV2, Permission } from './types';
import { verifyPublisherIdentity } from './publisher';

const HIGH_RISK = new Set<Permission>(['filesystem.write', 'network.unrestricted', 'shell', 'secrets.read', 'process.spawn']);

export interface SupplyChainScore {
  score: number;
  grade: 'A' | 'B' | 'C' | 'D' | 'F';
  checks: Array<{ id: string; points: number; passed: boolean }>;
  risks: string[];
}

export function scoreSupplyChain(item: EcosystemPackageV2): SupplyChainScore {
  const checks: SupplyChainScore['checks'] = [];
  const risks: string[] = [];
  let score = 0;
  const add = (id: string, points: number, passed: boolean) => { checks.push({ id, points, passed }); if (passed) score += points; };
  add('immutable-commit', 20, /^[a-f0-9]{40}$/i.test(item.source.commit || ''));
  add('registry-verified', 10, item.metadata?.verified === true);
  const publisher = verifyPublisherIdentity(item);
  add('publisher-identity', 15, publisher.verified);
  if (!publisher.verified) risks.push(...publisher.reasons);
  add('provenance', 15, Boolean(item.security?.provenance?.uri || item.security?.provenance?.digest));
  add('signature', 15, Boolean(item.security?.signature?.bundle || item.security?.signature?.identity));
  add('sbom', 10, Boolean(item.security?.sbom?.uri || item.security?.sbom?.digest));
  add('license', 5, Boolean(item.security?.license));
  const permissions = item.permissions || [];
  add('permissions-declared', 10, Array.isArray(item.permissions));
  const highRisk = permissions.filter((permission) => HIGH_RISK.has(permission));
  if (highRisk.length) risks.push(`high-risk permissions: ${highRisk.join(', ')}`);
  if (item.security?.yanked) risks.push('release is yanked');
  if (item.security?.deprecated) risks.push('package is deprecated');
  for (const advisory of item.security?.advisories || []) risks.push(`security advisory ${advisory.id}${advisory.severity ? ` (${advisory.severity})` : ''}`);
  if (item.security?.yanked) score = Math.min(score, 20);
  const grade = score >= 85 ? 'A' : score >= 70 ? 'B' : score >= 55 ? 'C' : score >= 40 ? 'D' : 'F';
  return { score, grade, checks, risks };
}
