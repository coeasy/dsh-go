import type { PackageType, ReleaseChannel } from '../protocol-core/index.mjs';

export interface RegistryV4Dependency {
  type: PackageType;
  id: string;
  range: string;
  channel: ReleaseChannel;
  optional?: boolean;
}

export interface RegistryV4Runtime {
  type: PackageType;
  [key: string]: unknown;
}

export interface RegistryV4Release {
  version: string;
  channel: ReleaseChannel;
  commit: string;
  published_at?: string;
  dependencies: RegistryV4Dependency[];
  compatibility: Record<string, unknown>;
  permissions: string[];
  artifact: Record<string, unknown>;
  security: Record<string, unknown>;
  entrypoints: Record<string, unknown>;
  runtime: RegistryV4Runtime;
  capabilities: string[];
  yanked: boolean;
  revoked: boolean;
}

export interface RegistryV4Package {
  type: PackageType;
  id: string;
  publisher_id: string;
  source: { provider: string; repo: string };
  metadata: Record<string, unknown>;
  releases: RegistryV4Release[];
}

export interface RegistryV4 {
  schema_version: 4;
  generated_at: string;
  revision: string;
  packages: RegistryV4Package[];
  publishers: Array<Record<string, unknown>>;
  advisories: Array<Record<string, unknown>>;
  metadata: Record<string, unknown>;
}

export const REGISTRY_SCHEMA_VERSION: 4;
export function buildRegistryV4(records: readonly any[], options?: { generated_at?: string; source?: string }): RegistryV4;
export function validateRegistryV4(registry: RegistryV4): RegistryV4;
export function registryRevision(registry: RegistryV4): string;
export function registryPackageMap(registry: RegistryV4): Map<string, RegistryV4Package>;
export function getRegistryPackage(registry: RegistryV4, type: PackageType, id: string): RegistryV4Package | null;
