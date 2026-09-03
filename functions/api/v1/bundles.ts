import { json, optionsResponse } from '../../_lib';

export const onRequestGet: PagesFunction = async () => json({
  version: 1,
  kind: 'bundle',
  execution: 'local-transaction-only',
  command: 'dsh bundle install <bundle.json> [--yes|--dry-run]',
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
    example: { name: 'team-toolkit', packages: ['plugin:example@*', 'skill:reviewer@^1.0.0', 'agent:workflow@1.2.0'] },
  },
});

export const onRequestOptions: PagesFunction = () => optionsResponse();
