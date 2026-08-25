export function checkRuntimeHealth(plugin) {
  const checks = {
    manifest: Boolean(plugin?.id),
    version: Boolean(plugin?.version),
    source: Boolean(plugin?.commit || plugin?.source),
    state: Boolean(plugin?.state),
  };

  const failed = Object.entries(checks)
    .filter(([, ok]) => !ok)
    .map(([name]) => name);

  return {
    status: failed.length === 0 ? "healthy" : "warning",
    checks,
    failed,
    checkedAt: new Date().toISOString(),
  };
}

export function healthSummary(records = []) {
  return records.map((record) => ({
    id: record.id,
    health: checkRuntimeHealth(record),
  }));
}
