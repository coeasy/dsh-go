import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');

describe('Sync freshness chain', () => {
  it('publishes authoritative freshness metadata with successful Registry V4 syncs', () => {
    const sync = read('.github/workflows/sync.yml');
    const assets = read('scripts/copy-assets-core.mjs');
    expect(sync).toContain('catalog/meta.json');
    expect(sync).toContain('DEPLOY_WORKFLOWS: deploy.yml deploy-pages.yml deploy-edgeone.yml monitor.yml');
    expect(assets).toContain("copyOptionalJson('meta.json')");
    expect(assets).toContain("resolve(ROOT, 'site/public/install')");
  });

  it('uses a bounded watchdog that recovers both missed cadence and missed daily full syncs', () => {
    const watchdog = read('.github/workflows/sync-watchdog.yml');
    expect(watchdog).toContain('cron: "55 * * * *"');
    expect(watchdog).toContain('actions: write');
    expect(watchdog).toContain('SYNC_MAX_AGE_HOURS: "6.5"');
    expect(watchdog).toContain('FULL_SYNC_MAX_AGE_HOURS: "26"');
    expect(watchdog).toContain('SYNC_STALE=');
    expect(watchdog).toContain('FULL_STALE=');
    expect(watchdog).toContain('if [ "$FULL_STALE" = "true" ]');
    expect(watchdog).toContain('.status == "requested"');
    expect(watchdog).toContain('.status == "waiting"');
    expect(watchdog).toContain('.status == "pending"');
    expect(watchdog).toContain('.status == "in_progress"');
    expect(watchdog).toContain('gh workflow run sync.yml --ref main -f mode="$MODE"');
    expect(watchdog).not.toContain('node scripts/sync-v3.mjs');
  });

  it('renders last successful sync from public catalog metadata in Beijing time', () => {
    const marketplace = read('site/src/components/MarketplaceV2.astro');
    expect(marketplace).toContain("resolve('public', 'catalog', 'meta.json')");
    expect(marketplace).toContain("timeZone: 'Asia/Shanghai'");
    expect(marketplace).toContain('data-market-sync-status');
    expect(marketplace).toContain('<time datetime={lastSyncAt}>{lastSyncTimeLabel}</time>');
    expect(marketplace).not.toContain("document.querySelector('.market-hero .metrics span:last-child b')");
  });
});
