import { defineConfig } from 'astro/config';
import { unified } from '@astrojs/markdown-remark';
import starlight from '@astrojs/starlight';
import react from '@astrojs/react';
import tailwindcss from '@tailwindcss/vite';
import { remarkDocsLinks } from './src/lib/remark-docs-links.mjs';

const base = process.env.DOCS_BASE_PATH || '/';
const site = process.env.DOCS_SITE_URL || 'https://shubhamtiwari909.github.io';
const production = process.env.DOCS_PRODUCTION === 'true';

export default defineConfig({
  site,
  base,
  trailingSlash: 'always',
  output: 'static',
  integrations: [
    starlight({
      title: 'VisualGuard',
      description: 'Practical guides for visual testing, shared reviews and confident releases.',
      logo: { src: './src/assets/logo.svg', replacesTitle: false },
      favicon: '/favicon.svg',
      social: [{ icon: 'github', label: 'GitHub', href: 'https://github.com/ShubhamTiwari909/visualguard-ai-testing' }],
      editLink: { baseUrl: 'https://github.com/ShubhamTiwari909/visualguard-ai-testing/edit/main/apps/docs/' },
      customCss: ['./src/styles/global.css'],
      components: { PageTitle: './src/components/PageTitle.astro' },
      head: production ? [] : [{ tag: 'meta', attrs: { name: 'robots', content: 'noindex, nofollow' } }],
      sidebar: [
        { label: 'Start here', items: [{ autogenerate: { directory: 'start' } }] },
        { label: 'Understand VisualGuard', items: [{ autogenerate: { directory: 'concepts' } }], collapsed: true },
        { label: 'Testing guides', items: [{ autogenerate: { directory: 'guides' } }], collapsed: true },
        { label: 'Dashboard & teams', items: [{ autogenerate: { directory: 'dashboard' } }], collapsed: true },
        { label: 'CI & pull requests', items: [{ autogenerate: { directory: 'ci' } }], collapsed: true },
        { label: 'Deployment & operations', items: [{ autogenerate: { directory: 'deployment' } }], collapsed: true },
        { label: 'Reference', items: [{ autogenerate: { directory: 'reference' } }], collapsed: true },
        { label: 'Troubleshooting', items: [{ autogenerate: { directory: 'troubleshooting' } }], collapsed: true },
        { label: 'Releases', items: [{ autogenerate: { directory: 'releases' } }], collapsed: true },
        { label: 'Contributing', items: [{ autogenerate: { directory: 'contributing' } }], collapsed: true },
      ],
    }),
    react(),
  ],
  markdown: { processor: unified({ remarkPlugins: [[remarkDocsLinks, { base }]] }) },
  vite: { plugins: [tailwindcss()] },
});
