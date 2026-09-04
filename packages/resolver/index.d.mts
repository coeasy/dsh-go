import type { PackageRequest, PackageType, ReleaseChannel } from '../protocol-core/index.mjs';

export interface RuntimeEnvironment {
  dsh_version?: string;
  runtime_version?: string;
  os?: string;
  arch?: string;
  [key: string]: unknown;
}

export interface ResolvedNode {
  key: string;
  type: PackageType;
  id: string;
  version: string;
  channel: ReleaseChannel;
  commit: string;
  artifact: Record<string, unknown>;
  permissions: string[];
  compatibility: Record<string, unknown>;
  security: Record<string, unknown>;
  dependencies: string[];
  publisher_id?: string;
  source?: Record<string, unknown>;
}

export interface ResolutionPlan {
  protocol_version: 2;
  registry_revision: string;
  resolution_hash: string;
  root: ResolvedNode;
  graph: ResolvedNode[];
  order: string[];
  permissions: string[];
  conflicts: unknown[];
  restart_required: true;
  environment: RuntimeEnvironment;
}

export function resolvePackage(registry: any, request: PackageRequest | Record<string, unknown>, environment?: RuntimeEnvironment): Readonly<ResolutionPlan>;
export function resolutionHash(plan: Omit<ResolutionPlan, 'resolution_hash'> | any): string;
