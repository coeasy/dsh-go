export interface RollbackRecord {
  id: string;
  previousVersion: string;
  backupPath: string;
}

export function createRollbackRecord(
  id: string,
  previousVersion: string,
  backupPath: string,
): RollbackRecord {
  return {
    id,
    previousVersion,
    backupPath,
  };
}

export function canRollback(record: RollbackRecord): boolean {
  return Boolean(record.id && record.previousVersion && record.backupPath);
}
