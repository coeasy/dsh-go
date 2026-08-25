export interface RuntimeBindingRequest {
  id: string;
  type: 'plugin' | 'mcp' | 'skill' | 'agent';
  version: string;
}

export interface RuntimeBindingResult {
  bound: boolean;
  runtime: string;
}

export function bindRuntime(request: RuntimeBindingRequest): RuntimeBindingResult {
  return {
    bound: Boolean(request.id),
    runtime: 'dsh-runtime-v3'
  };
}
