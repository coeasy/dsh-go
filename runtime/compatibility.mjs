import { arch as osArch, platform as osPlatform } from 'node:os';
import { satisfiesRange } from '../packages/protocol-core/index.mjs';
import { DSH_RUNTIME_VERSION } from './version.mjs';

function normalizePlatform(value) {
  const raw = String(value || '').toLowerCase();
  if (['mac', 'macos', 'osx'].includes(raw)) return 'darwin';
  if (['windows', 'win'].includes(raw)) return 'win32';
  return raw;
}

function list(value) {
  if (!value) return [];
  return (Array.isArray(value) ? value : [value]).map((item) => String(item).trim()).filter(Boolean);
}

export function currentRuntimeEnvironment(options = {}) {
  return {
    os: normalizePlatform(options.os || osPlatform()),
    arch: String(options.arch || osArch()).toLowerCase(),
    node: String(options.node || process.versions.node).replace(/^v/, ''),
    runtime: String(options.runtime || DSH_RUNTIME_VERSION).replace(/^v/, ''),
    client: String(options.client || process.env.DSH_CLIENT_VERSION || '0.0.0').replace(/^v/, ''),
    capabilities: [...new Set([...(options.capabilities || []), ...String(process.env.DSH_HOST_CAPABILITIES || '').split(',')].map((item) => item.trim()).filter(Boolean))],
  };
}

function checkVersion(name, actual, range, reasons, checks) {
  if (!range) return;
  const ok = satisfiesRange(actual, String(range));
  checks.push({ name, actual, expected: String(range), ok });
  if (!ok) reasons.push(`${name} ${actual} does not satisfy ${range}`);
}

export function evaluateCompatibility(item, environment = currentRuntimeEnvironment()) {
  const compatibility = item?.compatibility || item?.runtime?.compatibility || {};
  const reasons = [];
  const checks = [];
  const supportedOs = list(compatibility.os).map(normalizePlatform);
  if (supportedOs.length) {
    const ok = supportedOs.includes(normalizePlatform(environment.os));
    checks.push({ name: 'os', actual: environment.os, expected: supportedOs, ok });
    if (!ok) reasons.push(`os ${environment.os} is not supported (${supportedOs.join(', ')})`);
  }
  const supportedArch = list(compatibility.arch).map((value) => value.toLowerCase());
  if (supportedArch.length) {
    const ok = supportedArch.includes(String(environment.arch).toLowerCase());
    checks.push({ name: 'arch', actual: environment.arch, expected: supportedArch, ok });
    if (!ok) reasons.push(`arch ${environment.arch} is not supported (${supportedArch.join(', ')})`);
  }
  checkVersion('node', environment.node, compatibility.node, reasons, checks);
  checkVersion('runtime', environment.runtime, compatibility.runtime || compatibility.dsh_runtime, reasons, checks);
  if (compatibility.client || compatibility.dsh_client) {
    const clientRange = compatibility.client || compatibility.dsh_client;
    if (environment.client === '0.0.0') {
      checks.push({ name: 'client', actual: 'unknown', expected: clientRange, ok: false });
      reasons.push(`client version is required and must satisfy ${clientRange}`);
    } else checkVersion('client', environment.client, clientRange, reasons, checks);
  }
  const requiredCapabilities = list(compatibility.capabilities || compatibility.requires_capabilities);
  if (requiredCapabilities.length) {
    const available = new Set(environment.capabilities || []);
    const missing = requiredCapabilities.filter((capability) => !available.has(capability));
    checks.push({ name: 'capabilities', actual: [...available], expected: requiredCapabilities, ok: missing.length === 0 });
    if (missing.length) reasons.push(`missing host capabilities: ${missing.join(', ')}`);
  }
  return { compatible: reasons.length === 0, environment, checks, reasons };
}

export function assertCompatibility(item, environment) {
  const report = evaluateCompatibility(item, environment);
  if (!report.compatible) {
    const error = new Error(`package is not compatible: ${report.reasons.join('; ')}`);
    error.code = 'DSH_INCOMPATIBLE_PACKAGE';
    error.compatibilityReport = report;
    throw error;
  }
  return report;
}
