import { DeployGateChecker } from '../deploy/checker';

export class InstallFlow {
  constructor(private gate = new DeployGateChecker()) {}

  install(plugin: any) {
    const check = this.gate.check(plugin);
    if (!check.allowed) {
      return { state: 'failed', reason: check.reason };
    }
    return { state: 'installed', restartRequired: true };
  }
}
