import { cliLanguage, translate } from './i18n.mjs';

export function nativePackageManagerHelp(locale = cliLanguage()) {
  return `DSH Go CLI 0.1.0

${translate('native_package_manager', locale)}
  dsh package search <query> [--type plugin|mcp|skill|agent] [--channel stable|beta|nightly|dev]
  dsh package info <type:id|type:owner/repo> [--channel stable|beta|nightly|dev]
  dsh package outdated [--type plugin|mcp|skill|agent]
  dsh package install <type:id|type:owner/repo>[@version] [--yes|--dry-run]
  dsh package install ./package.dshpkg [--yes|--dry-run]
  dsh package export <type:id> --output package.dshpkg
  dsh package graph <type:id>[@range]
  dsh package explain <type:id>[@range]
  dsh package advisories <type:id>[@range]
  dsh package resolve-registry <type:id>[@range] [--registry <name>]
  dsh package list [--type plugin|mcp|skill|agent]
  dsh package status [type:id]
  dsh package lock <type:id> [--runtime-registry <path>]
  dsh cache status [--registry-cache <path>]

Publisher ecosystem
  dsh package manifest-v2 [package-root]
  dsh package publisher-check [package-root]
  dsh package submission-plan [package-root] [--output-dir <path>]
  dsh package init|validate|audit|sbom|publish-check ...

Registry federation
  dsh registry list [--file <path>]
  dsh registry add <name> <url> [--priority <n>] [--trusted]
  dsh registry remove <name>
  dsh registry refresh
  dsh registry doctor

Desktop and enterprise
  dsh enterprise status [--policy-file <path>] [--registries-file <path>]
  dsh enterprise policy show [--file <path>]
  dsh enterprise policy validate <policy.json>
  dsh enterprise policy apply <policy.json> --yes [--file <path>]
  dsh organization profile apply <profile.json> [--organization <id>] [--yes|--dry-run]
  dsh organization bundle install <bundle.json> [--organization <id>] [--yes|--dry-run]

${translate('typed_package_commands', locale)}
  dsh <plugin|mcp|skill|agent> search <query>
  dsh <plugin|mcp|skill|agent> info <id|owner/repo>[@version]
  dsh <plugin|mcp|skill|agent> install <id|owner/repo>[@version] [--yes|--dry-run]
  dsh <plugin|mcp|skill|agent> list|status|outdated|update|rollback|remove|uninstall|enable|disable|doctor|repair|history
  dsh <plugin|mcp|skill|agent> config get|set|unset ...

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

${translate('rules', locale)}
  - ${translate('rule_versionless', locale)}
  - ${translate('rule_permission', locale)}
  - ${translate('rule_dry_run', locale)}
  - ${translate('rule_host_approval', locale)}
  - ${translate('rule_no_restart', locale)}
  - Environment restore and .dshpkg install are local, integrity-checked, permission-gated, and never auto-restart the client.
  - Multi-registry package identity conflicts fail closed instead of silently overriding publishers.
  - Revoked or critical-advisory package versions are blocked by resolver and installer policy.
  - Enterprise policy can constrain registries, publishers, packages, permissions, lockfiles, profiles and bundles; enforcement is local and fail-closed.
  - Organization profile/bundle operations reuse the same Package Manager transaction engine instead of creating a separate enterprise installer.
  - The desktop Marketplace plugin uses authenticated local Client Host IPC; it cannot restart DSH and only emits a host-owned restart intent.
  - Publisher submission planning is local and non-mutating; Registry publication remains an explicit reviewed workflow.
  - Marketplace localization changes presentation only; package identity, permissions, versions, commits and trust evidence remain language-neutral.
  - Marketplace APIs and MCP are discovery/plan-only and cannot execute installation remotely.
  - ${translate('rule_pending_activation', locale)}
  - ${translate('rule_api', locale)}
`;
}

export function isHelpRequest(args = []) {
  return args.length === 0 || args.includes('--help') || args.includes('-h') || args[0] === 'help';
}
