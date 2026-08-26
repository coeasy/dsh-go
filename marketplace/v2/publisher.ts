import type { EcosystemPackageV2 } from './types';

export interface PublisherVerification {
  verified: boolean;
  provider: string;
  publisher: string;
  repositoryOwner: string;
  reasons: string[];
}

export function verifyPublisherIdentity(item: EcosystemPackageV2): PublisherVerification {
  const publisher = item.publisher;
  const repositoryOwner = String(item.source.repo || '').split('/')[0] || '';
  const reasons: string[] = [];
  if (!publisher?.id) reasons.push('publisher identity is not declared');
  if (publisher?.provider !== 'github') reasons.push('automatic publisher verification currently requires GitHub');
  if (publisher?.provider === 'github' && publisher.id && repositoryOwner && publisher.id.toLowerCase() !== repositoryOwner.toLowerCase()) {
    reasons.push(`publisher ${publisher.id} does not own repository ${item.source.repo}`);
  }
  if (publisher?.repository_ownership === 'unverified') reasons.push('repository ownership is explicitly unverified');
  return {
    verified: reasons.length === 0 && Boolean(publisher?.id && repositoryOwner),
    provider: publisher?.provider || 'unknown',
    publisher: publisher?.id || '',
    repositoryOwner,
    reasons,
  };
}
