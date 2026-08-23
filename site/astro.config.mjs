import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  // 绑定自定义域名后改为你的域名；默认用免费 pages.dev
  site: process.env.PUBLIC_SITE_URL || 'https://dsh-hub.pages.dev',
  output: 'static',
  trailingSlash: 'ignore',
  build: { inlineStylesheets: 'auto', assets: '_astro' },
  compressHTML: true,
  integrations: [sitemap()],
});
