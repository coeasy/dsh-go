export const DSH_PLATFORM_VERSION = '2.4.0';
export const DSH_RUNTIME_VERSION = '3.0.0';
export const DSH_REGISTRY_VERSION = 3;
export const DSH_REGISTRY_SCHEMA_VERSION = '3.0.0';
export const DSH_PACKAGE_MANIFEST_VERSION = '1.0.0';
export const DSH_DEFAULT_PACKAGE_VERSION = '0.1.0';

export function versionInfo() {
  return {
    platform: DSH_PLATFORM_VERSION,
    runtime: DSH_RUNTIME_VERSION,
    registry: DSH_REGISTRY_VERSION,
    registry_schema: DSH_REGISTRY_SCHEMA_VERSION,
    package_manifest: DSH_PACKAGE_MANIFEST_VERSION,
    default_package: DSH_DEFAULT_PACKAGE_VERSION,
  };
}
