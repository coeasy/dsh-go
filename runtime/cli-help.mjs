export function nativePackageManagerHelp() {
  return `DSH Go CLI 0.1.0

Native package manager
  dsh package search <query> [--type plugin|mcp|skill|agent] [--channel stable|beta|nightly|dev]
  dsh package info <type:id|type:owner/repo> [--channel stable|beta|nightly|dev]
  dsh package outdated [--type plugin|mcp|skill|agent]
  dsh package install <type:id|type:owner/repo>[@version] [--yes|--dry-run]
  dsh package list [--type plugin|mcp|skill|agent]
  dsh package status [type:id]

Typed package commands
  dsh <plugin|mcp|skill|agent> search <query>
  dsh <plugin|mcp|skill|agent> info <id|owner/repo>[@version]
  dsh <plugin|mcp|skill|agent> install <id|owner/repo>[@version] [--yes|--dry-run]
  dsh <plugin|mcp|skill|agent> list|status|outdated|update|rollback|remove|uninstall|enable|disable|doctor|repair|history
  dsh <plugin|mcp|skill|agent> config get|set|unset ...

Runtime controls
  dsh mcp start|stop|restart|process-status|logs|probe|invoke ...
  dsh skill load|unload|inspect|invoke ...
  dsh doctor [package-id] [--type plugin|mcp|skill|agent] [--quick]
  dsh startup activate
  dsh runtime info|check-update
  dsh runtime doctor [package-id] [--type plugin|mcp|skill|agent] [--quick]
  dsh runtime update [--dry-run]

Profiles, bundles and transactions
  dsh profile apply <profile.json> [--yes|--dry-run]
  dsh bundle install <bundle.json> [--yes|--dry-run]
  dsh secret set|get|list|delete ...
  dsh transaction recover

Host bridge
  dsh host uri <package-spec> [--type <type>] [--channel <name>]
  dsh host parse <dsh://...>
  dsh host handle <dsh://...> [--yes|--dry-run]
  dsh host registration|register

Developer package workflow
  dsh package init|validate|audit|sbom|publish-check ...

Rules
  - A versionless install resolves the latest compatible package from the selected channel (stable by default).
  - Dangerous or unknown permissions require explicit --yes approval before any dependency is installed.
  - --dry-run is always non-mutating and never requires approval.
  - Host/deep-link mutation never executes without explicit local approval.
  - Install/update/repair/rollback/enable/disable never restart the client automatically.
  - Installed packages that require activation remain pending until the desktop client calls 'dsh startup activate'.
  - Canonical remote APIs remain under /api/v1.
`;
}

export function isHelpRequest(args = []) {
  return args.length === 0 || args.includes('--help') || args.includes('-h') || args[0] === 'help';
}
