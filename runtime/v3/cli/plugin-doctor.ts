export interface PluginDoctorResult {
  healthy: boolean;
  checks: string[];
}

export function inspectPluginRuntime(id: string): PluginDoctorResult {
  return {
    healthy: true,
    checks: [`plugin:${id}`],
  };
}
