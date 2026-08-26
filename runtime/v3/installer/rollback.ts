import type { RuntimePackageType } from '../storage/persistence';

export interface RollbackRecord {
  id: string;
  type: RuntimePackageType;
  previousVersion: string;
  backupPath: string;
}

export function createRollbackRecord(
  id: string,
  previousVersion: string,
  backupPath: string,
  type: RuntimePackageType = 'plugin',
): RollbackRecord {
  return { id, type, previousVersion, backupPath };
}

export function canRollback(record: RollbackRecord): boolean {
  return Boolean(record.id && record.type && record.previousVersion && record.backupPath);
}
