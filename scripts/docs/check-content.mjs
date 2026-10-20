import { readFile, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { root, docsRoot, contentRoot, articles, headings, fail } from './shared.mjs';

const pages = await articles();
const errors = [];
const routes = new Set(pages.map(page => {
  const path = relative(contentRoot, page.path).replace(/\.mdx?$/, '').replace(/\/index$/, '');
  return path === 'index' ? '/' : `/${path}/`;
}));
for (const page of pages) {
  const name = relative(root, page.path);
  for (const key of ['title', 'description', 'audience', 'docType', 'channel', 'lastReviewed', 'verifiedAgainst']) if (typeof page.data[key] !== 'string' || !page.data[key].trim()) errors.push(`${name}: missing ${key}`);
  if (!Array.isArray(page.data.sourcePaths)) errors.push(`${name}: sourcePaths must be an array`);
  for (const path of page.data.sourcePaths ?? []) {
    try { await stat(join(root, path)); } catch { errors.push(`${name}: missing source ${path}`); }
  }
  if (/\b(TODO|TBD|FIXME|YYYY-MM-DD|REPLACE_WITH_TESTED_RELEASE)\b/.test(page.content)) errors.push(`${name}: unfinished public content`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(page.data.lastReviewed ?? '')) errors.push(`${name}: invalid review date`);
  if (page.data.docType === 'tutorial') {
    const titles = headings(page.content).join('\n');
    if (!/before you start|prerequisites/i.test(titles)) errors.push(`${name}: tutorial needs prerequisites`);
    if (!/verif|check|inspect/i.test(titles)) errors.push(`${name}: tutorial needs verification`);
    if (!/troubleshoot/i.test(titles)) errors.push(`${name}: tutorial needs troubleshooting`);
  }
}
const plan = await readFile(join(root, 'docs/DOCUMENTATION-WEBSITE-PLAN.md'), 'utf8');
const backlog = [...plan.matchAll(/`((?:start|concepts|guides|dashboard|ci|deployment|reference|troubleshooting|releases|contributing)\/[a-z0-9/-]+\/)`/g)].map(x => `/${x[1]}`.replace(/\/index\/$/, '/'));
for (const route of new Set(backlog)) if (!routes.has(route)) errors.push(`Planned route missing: ${route}`);
const coverage = JSON.parse(await readFile(join(docsRoot, 'src/data/coverage.json')));
for (const source of coverage.sources) {
  const titles = headings(await readFile(join(root, source), 'utf8'));
  const tracked = coverage.sections.filter(entry => entry.source === source);
  for (const title of titles) if (!tracked.some(entry => entry.heading === title)) errors.push(`Unmapped source section: ${source} / ${title}`);
}
for (const entry of coverage.sections) {
  if (!['migrated', 'superseded', 'retained historical'].includes(entry.disposition)) errors.push(`Invalid disposition: ${entry.source} / ${entry.heading}`);
  if (entry.disposition !== 'retained historical' && !routes.has(entry.destination)) errors.push(`Missing migration destination: ${entry.destination}`);
  if (!entry.reason?.trim()) errors.push(`Missing migration reason: ${entry.source} / ${entry.heading}`);
}
fail(errors);
console.log(`Content passed: ${pages.length} articles, every planned route, and ${coverage.sections.length} tracked source sections.`);
