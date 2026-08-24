/**
 * 站点链接工具。
 *
 * 把以 / 开头的绝对链接前缀化到当前部署的 base（如 GitHub Pages 的 <repo>/ 子路径），
 * 使项目站（https://<owner>.github.io/<repo>/）与根路径站点（Cloudflare pages.dev，默认 /）都能正确引用静态资源。
 *
 * 用法：`href={u('/plugin/foo')}`，根路径站点上渲染为 `/plugin/foo`，子路径站点上渲染为 `/repo/plugin/foo`。
 */
const BASE_URL = (import.meta.env.BASE_URL || '/').replace(/\/+$/, '');
// API 只存在于 Cloudflare（functions），与站点部署域名（可能是 GitHub Pages）分离。
// 必须在部署工作流注入 PUBLIC_API_URL（默认指向主站 pages.dev），避免 GitHub Pages 上 /api/* 相对链接 404。
const API_BASE = (import.meta.env.PUBLIC_API_URL || 'https://dsh-go.pages.dev').replace(/\/+$/, '');

export function u(path: string): string {
  const p = path.startsWith('/') ? path : `/${path}`;
  return `${BASE_URL}${p}`;
}

// 指向 API 的绝对链接（跨部署一致，GitHub Pages 上也能跳转到 Cloudflare 的 /api/*）
export function apiUrl(path: string): string {
  const p = path.startsWith('/') ? path : `/${path}`;
  return `${API_BASE}${p}`;
}

// 渲染给客户端用的 API Base（如 docs 页 / footer 的 data-api）
export function apiBase(): string {
  return API_BASE;
}