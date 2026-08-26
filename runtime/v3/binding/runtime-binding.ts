import type { RuntimePackageType } from '../storage/registry-store';

export interface RuntimeBindingRequest {
  id: string;
  type: RuntimePackageType;
  version: string;
  target?: string;
  capabilities?: string[];
}

export interface RuntimeBindingResult {
  bound: boolean;
  planned: boolean;
  runtime: 'dsh-runtime-v3';
  transport: 'local';
  packageKey: string;
  capabilities: string[];
  reason?: string;
}

export function bindRuntime(request: RuntimeBindingRequest, localRuntime = false): RuntimeBindingResult {
  const valid = Boolean(request.id.trim() && request.version.trim());
  const targetValid = !localRuntime || Boolean(request.target?.trim());
  return {
    bound: valid && targetValid && localRuntime,
    planned: valid,
    runtime: 'dsh-runtime-v3',
    transport: 'local',
    packageKey: `${request.type}:${request.id}`,
    capabilities: [...(request.capabilities ?? [])],
    reason: !valid
      ? 'runtime binding requires id and version'
      : !localRuntime
        ? 'binding requires the local DSH runtime'
        : !targetValid
          ? 'local binding requires an installed target path'
          : undefined,
  };
}
