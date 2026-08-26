export type EcosystemType = 'plugin' | 'mcp' | 'skill' | 'agent';
export type Permission = 'filesystem.read' | 'filesystem.write' | 'network' | 'network.unrestricted' | 'shell' | 'secrets.read' | 'mcp.tools' | 'process.spawn';

export interface CompatibilityDeclaration {
  os?: string[];
  arch?: string[];
  node?: string;
  runtime?: string;
  client?: string;
  capabilities?: string[];
}

export interface PublisherDeclaration {
  provider: 'github' | string;
  id: string;
  repository_ownership?: 'required' | 'declared' | 'unverified';
  verified_at?: string;
}

export interface SupplyChainDeclaration {
  provenance?: {
    provider?: string;
    uri?: string;
    digest?: string;
    required?: boolean;
    predicate_type?: string;
    builder_id?: string;
    build_type?: string;
    source_repository?: string;
  } | null;
  signature?: {
    provider?: string;
    bundle?: string;
    uri?: string;
    digest?: string;
    identity?: string;
    issuer?: string;
    oidc_issuer?: string;
    signed?: 'provenance' | 'sbom';
    required?: boolean;
  } | null;
  sbom?: { format?: string; uri?: string; digest?: string } | null;
  license?: string;
  advisories?: Array<{ id: string; severity?: string; url?: string }>;
  yanked?: boolean;
  deprecated?: boolean;
}

export interface EcosystemPackageV2 {
  id: string;
  version: string;
  type: EcosystemType;
  source: { repo?: string; commit?: string; ref?: string; archive_url?: string };
  metadata?: { name?: string; description?: string; verified?: boolean; stars?: number; category?: string; manifest_file?: string | null };
  capabilities?: string[];
  dependencies?: unknown[];
  permissions?: Permission[];
  compatibility?: CompatibilityDeclaration;
  publisher?: PublisherDeclaration;
  security?: SupplyChainDeclaration;
  conflicts?: string[];
  replaces?: string[];
  provides?: string[];
  type_config?: Record<string, unknown>;
}
