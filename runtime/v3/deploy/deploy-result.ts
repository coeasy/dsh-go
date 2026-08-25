export type DeployStatus = 'allowed' | 'blocked';

export interface DeployResult {
  status: DeployStatus;
  pluginId: string;
  checks: string[];
  errors: string[];
  restartRequired: boolean;
}
