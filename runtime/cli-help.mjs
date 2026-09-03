import { cliLanguage, translate } from './i18n.mjs';

export function nativePackageManagerHelp(locale = cliLanguage()) {
  return `DSH Go CLI 0.1.0

${translate('native_package_manager', locale)}
  dsh package search <query> [--type plugin|mcp|skill|agent] [--channel stable|beta|nightly|dev]
  dsh package info <type:id|type:owner/repo> [--channel stable|beta|nightly|dev]
  dsh package graph <type:id|type:owner/repo>[@range]
  dsh package explain <type:id|type:owner/repo>[@range]
  dsh package outdated [--type plugin|mcp|skill|agent]
  dsh package install <type:id|type:owner/repo>[@version] [--yes|--dry-run]
  dsh package list [--type plugin|mcp|skill|agent]
  dsh package status [type:id]
  dsh package lock <type:id> [--runtime-registry <path>]
  dsh package export <type:id> --output <file.dshpkg>
  dsh package install-file <file.dshpkg> [--yes|--dry-run]
  dsh cache status [--registry-cache <path>]

${translate('typed_package_commands', locale)}
  dsh <plugin|mcp|skill|agent> search <query>
  dsh <plugin|mcp|skill|agent> info <id|owner/repo>[@version]
  dsh <plugin|mcp|skill|agent> graph|explain <id|owner/repo>[@range]
  dsh <plugin|mcp|skill|agent> install <id|owner/repo>[@version] [--yes|--dry-run]
  dsh <plugin|mcp|skill|agent> list|status|outdated|update|rollback|remove|uninstall|enable|disable|doctor|repair|history
  dsh <plugin|mcp|skill|agent> config get|set|unset ...

Registry management
  dsh registry list [--file <registries.json>]
  dsh registry add <name> <url-or-path> [--priority <n>] [--trust <level>] [--mirrors <url1,url2>]
  dsh registry remove <name>
  dsh registry refresh [name]
  dsh registry doctor
  dsh registry merge
  Use --registry <name> for one configured Registry or --registry @all for deterministic multi-Registry merge.

Environment reproduction
  dsh lock [--file <path>] [--runtime-registry <path>] [--store <path>]
  dsh verify-lock [--file <path>] [--runtime-registry <path>] [--store <path>]
  dsh restore [--file <path>] [--runtime-registry <path>] [--store <path>] [--yes|--dry-run]

${translate('runtime_controls', locale)}
  dsh mcp start|stop|restart|process-status|logs|probe|invoke ...
  dsh skill load|unload|inspect|invoke ...
  dsh doctor [package-id] [--type plugin|mcp|skill|agent] [--quick]
  dsh startup activate
  dsh runtime info|check-update
  dsh runtime doctor [package-id] [--type plugin|mcp|skill|agent] [--quick]
  dsh runtime update [--dry-run]

${translate('profiles_bundles_transactions', locale)}
  dsh profile apply <profile.json> [--yes|--dry-run]
  dsh bundle install <bundle.json> [--yes|--dry-run]
  dsh secret set|get|list|delete ...
  dsh transaction recover

${translate('host_bridge', locale)}
  dsh host uri <package-spec> [--type <type>] [--channel <name>]
  dsh host parse <dsh://...>
  dsh host handle <dsh://...> [--yes|--dry-run]
  dsh host registration|register

${translate('developer_package_workflow', locale)}
  dsh package init|validate|audit|sbom|publish-check ...

${translate('rules', locale)}
  - ${translate('rule_versionless', locale)}
  - ${translate('rule_permission', locale)}
  - Any permission added by an update requires fresh explicit --yes approval.
  - Revoked/yanked packages and high/critical active advisories fail closed during resolution.
  - ${translate('rule_dry_run', locale)}
  - ${translate('rule_host_approval', locale)}
  - ${translate('rule_no_restart', locale)}
  - Environment restore and .dshpkg install are local/CAS-backed, require explicit --yes, and never auto-restart the client.
  - ${translate('rule_pending_activation', locale)}
  - ${translate('rule_api', locale)}
`;
}

export function isHelpRequest(args = []) {
  return args.length === 0 || args.includes('--help') || args.includes('-h') || args[0] === 'help';
}
