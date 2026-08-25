import type { ReleaseChannel } from '../../marketplace/v1/types';

export interface ProfileItemRequest {
  id: string;
  version?: string;
  channel?: ReleaseChannel;
  optional?: boolean;
}

export interface ProfileManifest {
  name: string;
  version: string;
  description?: string;
  items: ProfileItemRequest[];
}

export type BundleManifest = ProfileManifest;

export interface ProfileResolutionIssue {
  id: string;
  reason: string;
}
