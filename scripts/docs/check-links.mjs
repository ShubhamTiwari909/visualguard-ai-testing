import { readFile, stat } from 'node:fs/promises';
import { join, relative, resolve, extname, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { docsRoot, files, parse, fail } from './shared.mjs';

export async function checkLinks(directory, { base = '/', site = 'https://shubhamtiwari909.github.io' } = {}) {
  directory = resolve(directory);
  base = `/${base.split('/').filter(Boolean).join('/')}`;
  const siteOrigin = new URL(site).origin;
  const cache = new Map();
  const errors = [];
  let checked = 0;
  const documents = await files(directory, /\.html$/);
  for (const file of documents) {
    const dom = parse(await readFile(file, 'utf8'));
    const ids = new Set();
    const links = [];
    function visit(node) {
      for (const attribute of node.attrs ?? []) {
        if (attribute.name === 'id') ids.add(attribute.value);
        // Starlight's error document uses a /404/ canonical while hosting emits 404.html.
        // This metadata is not a navigable page link; still validate every link in its body.
        if (file === join(directory, '404.html') && node.tagName === 'link' && node.attrs.some(attr => attr.name === 'rel' && attr.value === 'canonical')) continue;
        if (['href', 'src', 'poster'].includes(attribute.name)) links.push(attribute.value);
      }
      node.childNodes?.forEach(visit);
    }
    visit(dom);
    cache.set(file, { ids, links });
  }
  for (const [file, { links }] of cache) {
    const location = relative(directory, file).split(sep).join('/');
    const path = location.endsWith('index.html') ? location.slice(0, -10) : location;
    const pageUrl = new URL(`${base === '/' ? '' : base}/${path}`, siteOrigin);
    for (const link of links) {
      if (!link || /^(data:|mailto:|tel:|javascript:)/.test(link)) continue;
      let url;
      try { url = new URL(link, pageUrl); } catch { errors.push(`${location}: invalid URL ${link}`); continue; }
      if (url.origin !== siteOrigin) continue;
      if (base !== '/' && url.pathname !== base && !url.pathname.startsWith(`${base}/`)) { errors.push(`${location}: escapes configured base: ${link}`); continue; }
      let pathname;
      try { pathname = decodeURIComponent(base === '/' ? url.pathname : url.pathname.slice(base.length)); } catch { errors.push(`${location}: invalid encoded path ${link}`); continue; }
      let target = resolve(directory, `.${pathname.startsWith('/') ? pathname : '/' + pathname}`);
      if (target !== directory && !target.startsWith(directory + sep)) { errors.push(`${location}: escapes output: ${link}`); continue; }
      try {
        if ((await stat(target)).isDirectory()) target = join(target, 'index.html');
        await stat(target);
      } catch { errors.push(`${location}: missing target ${link}`); continue; }
      if (url.hash && extname(target) === '.html') {
        let id;
        try { id = decodeURIComponent(url.hash.slice(1)); } catch { errors.push(`${location}: invalid anchor ${link}`); continue; }
        if (id && !cache.get(target)?.ids.has(id)) errors.push(`${location}: missing anchor ${link}`);
      }
      checked++;
    }
  }
  fail(errors);
  return { pages: documents.length, links: checked };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const result = await checkLinks(process.argv[2] || join(docsRoot, 'dist'), { base: process.env.DOCS_BASE_PATH, site: process.env.DOCS_SITE_URL });
  console.log(`Links passed: ${result.pages} generated pages and ${result.links} internal links/assets/anchors.`);
}
