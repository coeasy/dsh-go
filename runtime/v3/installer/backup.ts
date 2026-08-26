import type { RuntimePackageType } from '../storage/persistence';

export interface BackupRecord {
  id: string;
  type: RuntimePackageType;
  source: string;
  backupPath: string;
  createdAt: string;
}

export function createBackupRecord(id: string, source: string, type: RuntimePackageType = 'plugin'): BackupRecord {
  return {
    id,
    type,
    source,
    backupPath: `${source}.backup`,
    createdAt: new Date().toISOString(),
  };
}
