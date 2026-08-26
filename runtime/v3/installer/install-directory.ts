export type PackageType = 'plugin' | 'mcp' | 'skill' | 'agent';

export interface InstallDirectory {
  root: string;
  packages: Record<PackageType, string>;
  registry: string;
  cache: string;
}

export function getInstallDirectory(home: string): InstallDirectory {
  const root = `${home}/.dsh`;
  return {
    root,
    packages: {
      plugin: `${root}/plugins`,
      mcp: `${root}/packages/mcp`,
      skill: `${root}/packages/skill`,
      agent: `${root}/packages/agent`,
    },
    registry: `${root}/registry/runtime.json`,
    cache: `${root}/cache`,
  };
}
