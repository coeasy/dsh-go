import type { RuntimeRecord } from '../storage/persistence';

export interface PluginDoctorResult {
  healthy: boolean;
  checks: string[];
  warnings: string[];
}

export function inspectPluginRuntime(id: string, record?: RuntimeRecord): PluginDoctorResult {
  const checks = [`plugin:${id}`];
  const warnings: string[] = [];
  if (!id.trim()) return { healthy: false, checks, warnings: ['plugin id is required'] };
  if (!record) return { healthy: false, checks, warnings: ['runtime state must be read by the local Runtime Platform V2'] };
  checks.push(`state:${record.state}`, `version:${record.version}`);
  const healthy = record.id === id && record.state !== 'failed';
  if (!healthy) warnings.push('runtime registry record is inconsistent or failed');
  return { healthy, checks, warnings };
}
