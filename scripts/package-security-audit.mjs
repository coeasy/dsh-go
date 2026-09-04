#!/usr/bin/env node
import { readFile, readdir } from 'node:fs/promises';
import { extname, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readDshManifest } from '../runtime/package-manifest.mjs';
import { inspectPermissions } from '../runtime/permissions.mjs';

const SOURCE_EXTENSIONS = new Set(['.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.sh', '.ps1']);
const MAX_FILE_BYTES = 512 * 1024;
const RULES = [
  { id: 'shell-pipe-download', severity: 'high', re: /\b(?:curl|wget)\b[^\n|;]*(?:\||;)\s*(?:bash|sh|zsh|pwsh|powershell)\b/i, permission: 'shell' },
  { id: 'dynamic-eval', severity: 'high', re: /\b(?:eval|Function)\s*\(/, permission: 'shell' },
  { id: 'child-process', severity: 'medium', re: /(?:node:)?child_process|\bexec(?:File|Sync)?\s*\(|\bspawn(?:Sync)?\s*\(/, permission: 'process.spawn' },
  { id: 'secret-env-access', severity: 'medium', re: /process\.env\.(?:TOKEN|API_KEY|SECRET|PASSWORD|AUTH)|process\.env\[['"](?:TOKEN|API_KEY|SECRET|PASSWORD|AUTH)/i, permission: 'secrets.read' },
  { id: 'filesystem-write', severity: 'medium', re: /\b(?:writeFile|appendFile|rm|unlink|rename|mkdir)\s*\(/, permission: 'filesystem.write' },
  { id: 'network-call', severity: 'low', re: /\bfetch\s*\(|\baxios\.(?:get|post|put|patch|delete|request)\s*\(|\bhttps?\.(?:get|request)\s*\(|(?:from|require\s*\()\s*['"](?:node:)?https?['"]/i, permission: 'network' },
];

async function walk(root, out = [], depth = 0) {
  if (depth > 8) return out;
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (['node_modules', '.git', 'dist', 'build', '.dsh'].includes(entry.name)) continue;
    const path = join(root, entry.name);
    if (entry.isDirectory()) await walk(path, out, depth + 1);
    else if (SOURCE_EXTENSIONS.has(extname(entry.name).toLowerCase())) out.push(path);
  }
  return out;
}

export async function auditPackageSecurity(root = process.cwd()) {
  const base = resolve(root);
  const manifestResult = await readDshManifest(base);
  const manifest = manifestResult.manifest;
  const declared = inspectPermissions(manifest.permissions || []);
  const declaredSet = new Set(declared.permissions);
  const findings = [];
  for (const file of await walk(base)) {
    let text;
    try {
      const buffer = await readFile(file);
      if (buffer.byteLength > MAX_FILE_BYTES) continue;
      text = buffer.toString('utf8');
    } catch { continue; }
    for (const rule of RULES) {
      if (!rule.re.test(text)) continue;
      findings.push({
        rule: rule.id,
        severity: rule.severity,
        file: relative(base, file).replaceAll('\\', '/'),
        required_permission: rule.permission,
        permission_declared: declaredSet.has(rule.permission) || (rule.permission === 'network' && declaredSet.has('network.unrestricted')),
      });
    }
  }
  try {
    const pkg = JSON.parse(await readFile(join(base, 'package.json'), 'utf8'));
    for (const [name, value] of Object.entries(pkg.scripts || {})) {
      const script = String(value || '');
      if (/\b(?:curl|wget)\b|\b(?:bash|sh|powershell|pwsh)\b/i.test(script)) {
        findings.push({ rule: 'package-script-shell', severity: 'high', file: 'package.json', script: name, required_permission: 'shell', permission_declared: declaredSet.has('shell') });
      }
    }
  } catch { /* package.json is optional */ }
  const undeclared = findings.filter((finding) => finding.required_permission && !finding.permission_declared);
  const high = findings.filter((finding) => finding.severity === 'high');
  return {
    safe: undeclared.length === 0 && high.every((finding) => finding.permission_declared),
    manifest: manifestResult.file,
    manifest_version: manifest.manifest_version,
    package: { type: manifest.type, id: manifest.id, version: manifest.version, channel: manifest.channel },
    publisher: manifest.publisher.id,
    declared_permissions: declared.permissions,
    findings,
    undeclared_permissions: [...new Set(undeclared.map((finding) => finding.required_permission))].sort(),
    trust_note: 'local source audit does not establish publisher ownership or cryptographic release trust',
  };
}

async function main() {
  const root = process.argv[2] || process.cwd();
  const report = await auditPackageSecurity(root);
  console.log(JSON.stringify(report, null, 2));
  if (!report.safe) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => { console.error(error.stack || error.message); process.exit(1); });
}
