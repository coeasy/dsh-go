import type { RuntimePackageType, RuntimeRecord } from '../storage/persistence';

export interface RuntimeDoctorResult {
  healthy: boolean;
  checks: string[];
  warnings: string[];
}

export function inspectPackageRuntime(
  type: RuntimePackageType,
  id: string,
  record?: RuntimeRecord,
): RuntimeDoctorResult {
  const checks = [`package:${type}:${id}`];
  const warnings: string[] = [];
  if (!id.trim()) return { healthy: false, checks, warnings: ['runtime package id is required'] };
  if (!record) return { healthy: false, checks, warnings: ['runtime state must be read by the local Runtime Platform V3'] };
  checks.push(`type:${record.type}`, `state:${record.state}`, `version:${record.version}`);
  const healthy = record.id === id && record.type === type && record.state !== 'failed' && record.state !== 'removed';
  if (!healthy) warnings.push('runtime registry record is inconsistent, failed, or removed');
  return { healthy, checks, warnings };
}

export type PluginDoctorResult = RuntimeDoctorResult;

export function inspectPluginRuntime(id: string, record?: RuntimeRecord): PluginDoctorResult {
  return inspectPackageRuntime('plugin', id, record);
}
