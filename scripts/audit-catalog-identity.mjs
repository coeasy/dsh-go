#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { canonicalRepoKey, canonicalRepoUrl, makeInstallCmd, normalizeHttpUrl, normalizeOverrideFields, repoNameFromFullName } from './repository-identity.mjs';

export function auditCatalogIdentity(data) {
  const errors = [];
  const repos = new Set();
  const repoIds = new Set();
  for (const plugin of data?.plugins || []) {
    const label = plugin.full_name || plugin.slug || '<unknown>';
    const key = canonicalRepoKey(plugin.full_name);
    const repoName = repoNameFromFullName(plugin.full_name);
    if (!repoName) errors.push(`${label}: invalid full_name`);
    if (repos.has(key)) errors.push(`${label}: duplicate repository after case normalization`);
    repos.add(key);
    if (plugin.repo_id) {
      const id = String(plugin.repo_id);
      if (repoIds.has(id)) errors.push(`${label}: duplicate repo_id ${id}`);
      repoIds.add(id);
    }
    if (plugin.repo_name !== repoName) errors.push(`${label}: repo_name mismatch (${plugin.repo_name || '<missing>'})`);
    if (plugin.repo_url !== canonicalRepoUrl(plugin.full_name)) errors.push(`${label}: non-canonical repo_url (${plugin.repo_url || '<missing>'})`);
    if (plugin.install_cmd !== makeInstallCmd(plugin.full_name, plugin.category || 'other')) errors.push(`${label}: install_cmd source mismatch`);
    if (plugin.manifest_file && plugin.manifest_file !== 'dsh-plugin.json') errors.push(`${label}: package/non-DSH manifest used (${plugin.manifest_file})`);
    if (plugin.verified && plugin.manifest_file !== 'dsh-plugin.json') errors.push(`${label}: verified without dsh-plugin.json`);
    if (plugin.metadata_source === 'github' && plugin.name !== repoName) errors.push(`${label}: GitHub-sourced name mismatch (${plugin.name})`);
    const overrideFields = normalizeOverrideFields(plugin.override_fields);
    if (plugin.metadata_source === 'override' && overrideFields.length === 0) errors.push(`${label}: override source missing field-level provenance`);
    if (Array.isArray(plugin.override_fields) && overrideFields.length !== plugin.override_fields.length) errors.push(`${label}: unsupported override_fields`);
    if (plugin.homepage && normalizeHttpUrl(plugin.homepage) !== plugin.homepage) errors.push(`${label}: invalid/non-normalized homepage`);
    if (plugin.repo_url?.startsWith('https://api.github.com/')) errors.push(`${label}: GitHub API URL exposed as repository URL`);
    if (Object.prototype.hasOwnProperty.call(plugin, 'observed_at')) errors.push(`${label}: transient observed_at leaked into persisted catalog`);
  }
  return { errors, count: data?.plugins?.length || 0 };
}

async function main() {
  const file = process.argv.find((arg) => arg.endsWith('.json')) || resolve(process.cwd(), 'catalog/plugins.json');
  const strict = process.argv.includes('--strict');
  const data = JSON.parse(await readFile(file, 'utf8'));
  const result = auditCatalogIdentity(data);
  console.log(`[identity-audit] plugins=${result.count} errors=${result.errors.length}`);
  result.errors.slice(0, 100).forEach((error) => console.error(`[identity-audit] ${error}`));
  if (strict && result.errors.length) process.exit(1);
}

if (process.argv[1]?.endsWith('audit-catalog-identity.mjs')) main().catch((error) => { console.error(error); process.exit(1); });
