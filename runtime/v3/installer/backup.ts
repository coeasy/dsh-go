export interface BackupRecord {
  id: string;
  source: string;
  backupPath: string;
  createdAt: string;
}

export function createBackupRecord(id: string, source: string): BackupRecord {
  return {
    id,
    source,
    backupPath: `${source}.backup`,
    createdAt: new Date().toISOString(),
  };
}
