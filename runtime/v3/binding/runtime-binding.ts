export interface RuntimeBindingRequest {
  id: string;
  type: 'plugin' | 'mcp' | 'skill' | 'agent';
  version: string;
}

export interface RuntimeBindingResult {
  bound: boolean;
  planned: boolean;
  runtime: 'dsh-runtime-v3';
  transport: 'local';
  reason?: string;
}

export function bindRuntime(request: RuntimeBindingRequest, localRuntime = false): RuntimeBindingResult {
  const valid = Boolean(request.id.trim() && request.version.trim());
  return {
    bound: valid && localRuntime,
    planned: valid,
    runtime: 'dsh-runtime-v3',
    transport: 'local',
    reason: !valid ? 'runtime binding requires id and version' : localRuntime ? undefined : 'binding requires the local DSH runtime',
  };
}
