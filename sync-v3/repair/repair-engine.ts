export interface RepairResult {
  repaired: string[];
  removed: string[];
}

export class RepairEngine {
  repair(items: any[]): RepairResult {
    const seen = new Set<string>();
    const repaired: string[] = [];
    const removed: string[] = [];

    for (const item of items) {
      if (!item.id) {
        removed.push('unknown');
        continue;
      }
      if (seen.has(item.id)) {
        removed.push(item.id);
        continue;
      }
      seen.add(item.id);
      repaired.push(item.id);
    }
    return { repaired, removed };
  }
}
