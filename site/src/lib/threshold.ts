import marketplacePolicy from '../../../config/marketplace-policy.json';

// Single source of truth shared with build-time generators.
export const DETAIL_THRESHOLD = marketplacePolicy.detail.min_stars;
