import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  // 绑定自定义域名后改为你的域名；默认用免费 pages.dev
  site: process.env.PUBLIC_SITE_URL || 'https://dsh-hub.pages.dev',
  // GitHub Pages 项目站部署在 <repo>/ 子路径时，由 deploy-pages.yml 注入 PUBLIC_BASE_PATH。
  // Cloudflare 部署不注入该变量 → base 保持默认 '/'（根路径），前端链接不受影响。
  base: process.env.PUBLIC_BASE_PATH || '/',
  output: 'static',
  trailingSlash: 'ignore',
  build: { inlineStylesheets: 'auto', assets: '_astro' },
  compressHTML: true,
  integrations: [sitemap()],
});
