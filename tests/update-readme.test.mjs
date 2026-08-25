import { describe, it, expect } from 'vitest';
import { isDshRelated, pickHot, buildTable } from '../scripts/update-readme.mjs';

// 构造一条插件的最小对象
const p = (full_name, stars, updated_at) => ({
  full_name,
  name: full_name.split('/')[1],
  stars,
  updated_at,
  language: 'TypeScript',
  description: 'x',
});

describe('update-readme 推荐表生成', () => {
  it('isDshRelated：DSH 原生命名命中，无关老项目剔除', () => {
    expect(isDshRelated(p('ccch1mneyyy/dsh-TUI', 2400, '2026-08-24'))).toBe(true);
    expect(isDshRelated(p('dsh-market/dsh-market', 2100, '2026-08-24'))).toBe(true);
    expect(isDshRelated(p('dsh-tauri-desk/deepseek-harness-desktop', 1100, '2026-08-24'))).toBe(true);
    // 只打了 dsh-plugin 标签但与 DSH 无关的老项目 → 应剔除
    expect(isDshRelated(p('GCWing/BitFun', 1800, '2026-08-24'))).toBe(false);
    expect(isDshRelated(p('imsai-sh/zhuzhiliao', 2900, '2026-08-14'))).toBe(false);
    expect(isDshRelated(p('TencentCloudBase/CloudBase-AI-Toolkit', 1100, '2026-08-24'))).toBe(false);
    // 无 pinned 名单时，modlens 命名不含 dsh → 不命中命名过滤
    expect(isDshRelated(p('liustack/modlens', 3560, '2026-08-24'))).toBe(false);
  });

  it('pickHot：区间过滤 + DSH 过滤 + 按最近更新降序 + Top 截断', () => {
    const list = [
      p('other/vibe-skills', 3000, '2026-08-11'), // 无关 → 排除
      p('gcwing/bitfun', 1800, '2026-08-24'), // 无关 → 排除
      p('ysr666/dsh-vision-router', 952, '2026-08-24'),
      p('ccch1mneyyy/dsh-TUI', 2400, '2026-08-23'),
      p('deepseek/dsh-harness', 400, '2026-08-22'), // 低于 min(500) → 排除
      p('omdsh-dev/DSH-better-sidebar', 999, '2026-08-20'),
    ];
    // pinned:[] 关闭必需推荐，纯测过滤/排序/截断
    const hot = pickHot(list, { min: 500, max: 3000, top: 2, pinned: [] });
    expect(hot.map((x) => x.full_name)).toEqual([
      'ysr666/dsh-vision-router', // 更新最新排最前
      'ccch1mneyyy/dsh-TUI',
    ]);
    expect(hot.length).toBe(2);
  });

  it('pickHot：pinned 必需项即使命名不含 dsh 也被强制纳入且置顶', () => {
    const list = [
      p('liustack/modlens', 3560, '2026-08-24'), // 非 dsh 命名，但反向命中 pinned
      p('ysr666/dsh-vision-router', 952, '2026-08-24'),
      p('ccch1mneyyy/dsh-TUI', 2400, '2026-08-23'),
    ];
    const hot = pickHot(list, { top: 2 });
    expect(hot.length).toBe(2);
    expect(hot[0].full_name).toBe('liustack/modlens'); // pinned 置顶
    // pinned 不因 top=2 被裁剪
    expect(hot[0].full_name).toBe('liustack/modlens');
  });

  it('pickHot：archived/disabled 即使 pinned 也不会重新公开', () => {
    const archivedPinned = { ...p('liustack/modlens', 3560, '2026-08-24'), deprecated: true };
    const disabled = { ...p('ysr666/dsh-disabled', 952, '2026-08-24'), disabled: true };
    const active = p('ccch1mneyyy/dsh-TUI', 2400, '2026-08-23');
    const hot = pickHot([archivedPinned, disabled, active], { min: 300, max: 5000, top: 10 });
    expect(hot.map((x) => x.full_name)).toEqual(['ccch1mneyyy/dsh-TUI']);
  });

  it('buildTable：非空输出表头与行，空列表输出占位', () => {
    const row = buildTable([p('ysr666/dsh-vision-router', 952, '2026-08-24')]);
    expect(row).toContain('| # | 插件 |');
    expect(row).toContain('dsh-vision-router');
    expect(buildTable([])).toContain('暂未收录');
  });
});