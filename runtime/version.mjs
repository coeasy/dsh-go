export const DSH_PLATFORM_VERSION = '0.1.0';
export const DSH_RUNTIME_VERSION = '0.1.0';
export const DSH_API_VERSION = 'v2';
export const DSH_PROTOCOL_VERSION = 2;
export const DSH_REGISTRY_VERSION = 4;
export const DSH_REGISTRY_SCHEMA_VERSION = 4;
export const DSH_DISTRIBUTION_VERSION = 2;
export const DSH_SEARCH_INDEX_VERSION = 3;
export const DSH_RUNTIME_STATE_VERSION = 4;
export const DSH_PACKAGE_MANIFEST_VERSION = 2;

export function versionInfo() {
  return {
    platform: DSH_PLATFORM_VERSION,
    runtime: DSH_RUNTIME_VERSION,
    api: DSH_API_VERSION,
    protocol: DSH_PROTOCOL_VERSION,
    registry: DSH_REGISTRY_VERSION,
    registry_schema: DSH_REGISTRY_SCHEMA_VERSION,
    distribution: DSH_DISTRIBUTION_VERSION,
    search_index: DSH_SEARCH_INDEX_VERSION,
    runtime_state: DSH_RUNTIME_STATE_VERSION,
    package_manifest: DSH_PACKAGE_MANIFEST_VERSION,
  };
}
