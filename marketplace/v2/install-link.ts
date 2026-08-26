import type { EcosystemPackageV2 } from './types';

export function ecosystemInstallCommand(item: EcosystemPackageV2): string {
  return `dsh ${item.type} install ${item.id}@${item.version}`;
}

export function ecosystemInstallLink(item: EcosystemPackageV2, registry?: string): string {
  const query = new URLSearchParams({ id: item.id, version: item.version, type: item.type });
  if (registry) query.set('registry', registry);
  return `dsh://install?${query.toString()}`;
}
