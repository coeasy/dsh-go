import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');

describe('Sync freshness chain', () => {
  it('deploys authoritative freshness metadata with successful canonical syncs', () => {
    const sync = read('.github/workflows/sync.yml');
    expect(sync).toContain('catalog/meta.json');
    expect(sync).toContain('DEPLOY_WORKFLOWS: deploy.yml deploy-pages.yml deploy-edgeone.yml monitor.yml');
    expect(sync).toContain('public freshness state');
  });

  it('uses a bounded watchdog that only dispatches the canonical sync workflow', () => {
    const watchdog = read('.github/workflows/sync-watchdog.yml');
    expect(watchdog).toContain('cron: "5 * * * *"');
    expect(watchdog).toContain('actions: write');
    expect(watchdog).toContain('SYNC_MAX_AGE_HOURS: "6.5"');
    expect(watchdog).toContain('FULL_SYNC_MAX_AGE_HOURS: "26"');
    expect(watchdog).toContain('.status == "queued" or .status == "in_progress"');
    expect(watchdog).toContain('gh workflow run sync.yml --ref main -f mode="$MODE"');
    expect(watchdog).not.toContain('node scripts/sync-v3.mjs');
  });

  it('renders last successful sync from catalog metadata in Beijing time on the homepage', () => {
    const homepage = read('site/src/pages/index.astro');
    expect(homepage).toContain("'catalog', 'meta.json'");
    expect(homepage).toContain("timeZone: 'Asia/Shanghai'");
    expect(homepage).toContain('data-market-sync-status');
    expect(homepage).toContain("document.querySelector('.market-hero .metrics span:last-child b')");
  });
});
