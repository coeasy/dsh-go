import { json } from '../../_lib';

export const onRequestGet: PagesFunction = async () => json({
  version: 1,
  kind: 'profile',
  execution: 'local-transaction-only',
  command: 'dsh profile apply <profile.json> [--yes|--dry-run]',
  semantics: {
    atomic: true,
    dependency_resolution: 'Package Manager Core V2',
    permission_gate: true,
    crash_recovery: true,
    restart: 'pending-restart',
    remote_mutation: false,
  },
  schema: {
    package_keys: ['packages', 'items', 'plugins'],
    versionless: 'latest compatible stable',
    example: { name: 'developer', packages: ['plugin:example@*', { type: 'mcp', id: 'server', version: '^1.0.0' }] },
  },
});
