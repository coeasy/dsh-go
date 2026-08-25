import { buildRuntimeInstallPlan, type LocalInstallPlan } from '../../marketplace/v1/install-adapter';
import type { MarketplaceItem } from '../../marketplace/v1/types';
import { resolveProfile, type ProfileResolution } from './resolver';
import type { ProfileManifest } from './types';

export interface ProfileInstallPlan {
  profile: string;
  valid: boolean;
  resolution: ProfileResolution;
  installs: LocalInstallPlan[];
  requiresLocalRuntime: true;
}

export function buildProfileInstallPlan(profile: ProfileManifest, registry: MarketplaceItem[]): ProfileInstallPlan {
  const resolution = resolveProfile(profile, registry);
  return {
    profile: profile.name,
    valid: resolution.valid,
    resolution,
    installs: resolution.valid
      ? resolution.items.map((item) => buildRuntimeInstallPlan({ id: item.id, version: item.version, channel: item.channel }))
      : [],
    requiresLocalRuntime: true,
  };
}
