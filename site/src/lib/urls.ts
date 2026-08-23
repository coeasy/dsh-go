/**
 * 站点链接工具。
 *
 * 把以 / 开头的绝对链接前缀化到当前部署的 base（如 GitHub Pages 的 <repo>/ 子路径），
 * 使项目站（https://<owner>.github.io/<repo>/）与根路径站点（Cloudflare pages.dev，默认 /）都能正确引用静态资源。
 *
 * 用法：`href={u('/plugin/foo')}`，根路径站点上渲染为 `/plugin/foo`，子路径站点上渲染为 `/repo/plugin/foo`。
 */
const BASE_URL = (import.meta.env.BASE_URL || '/').replace(/\/+$/, '');

export function u(path: string): string {
  const p = path.startsWith('/') ? path : `/${path}`;
  return `${BASE_URL}${p}`;
}