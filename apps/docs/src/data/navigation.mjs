const pages = (...slugs) => slugs.map(slug => ({ slug }));

// This manifest drives the sidebar and the missing/unlisted-page check.
export const navigation = [
  { label: 'Start here', items: pages('start/choose-setup', 'start/requirements', 'start/install', 'start/quickstart', 'start/common-tasks') },
  { label: 'Understand VisualGuard', collapsed: true, items: pages('concepts/how-it-works', 'concepts/comparison-modes', 'concepts/results', 'concepts/glossary', 'concepts/faq') },
  { label: 'Testing guides', collapsed: true, items: [
    { label: 'Set up comparisons', items: pages('guides/zero-config-scans', 'guides/configuration', 'guides/routes', 'guides/browsers-and-viewports', 'guides/stable-captures', 'guides/section-capture', 'guides/application-auth', 'guides/playwright', 'guides/nextjs-example') },
    { label: 'Understand and act on results', items: pages('guides/diff-and-noise', 'guides/reports', 'guides/accepting-changes', 'guides/local-baselines', 'guides/fixes', 'guides/accessibility-and-performance') },
    { label: 'Add AI analysis', items: pages('guides/ai-gemini', 'guides/ai-ollama', 'guides/ai-policy-and-budgets') },
    { label: 'Automate and extend', items: pages('guides/watch', 'guides/monitoring', 'guides/programmatic-api', 'guides/reporters') },
  ] },
  { label: 'Dashboard & teams', collapsed: true, items: pages('dashboard/overview', 'dashboard/local', 'dashboard/tour', 'dashboard/login', 'dashboard/google-sign-in', 'dashboard/projects', 'dashboard/people-and-permissions', 'dashboard/publishing', 'dashboard/project-configuration', 'dashboard/run-tests', 'dashboard/execution-progress', 'dashboard/private-runners', 'dashboard/reviews', 'dashboard/approved-baselines', 'dashboard/visual-policies') },
  { label: 'CI & pull requests', collapsed: true, items: pages('ci/overview', 'ci/github-actions', 'ci/preview-deployments', 'ci/github-checks', 'ci/sharding') },
  { label: 'Deployment & operations', collapsed: true, items: pages('deployment/overview', 'deployment/storage-and-backups', 'deployment/postgresql', 'deployment/cloud-sql', 'deployment/mongodb', 'deployment/cloud-run', 'deployment/vercel', 'deployment/operations-and-recovery', 'deployment/upgrades') },
  { label: 'Reference', collapsed: true, items: [
    ...pages('reference/cli'),
    { label: 'Command details', items: pages('reference/cli/testing', 'reference/cli/baselines', 'reference/cli/dashboard') },
    ...pages('reference/configuration', 'reference/environment', 'reference/api', 'reference/artifacts', 'reference/exit-codes', 'reference/compatibility'),
  ] },
  { label: 'Troubleshooting', collapsed: true, items: pages('troubleshooting', 'troubleshooting/installation', 'troubleshooting/capture', 'troubleshooting/ci', 'troubleshooting/dashboard') },
  { label: 'Releases', collapsed: true, items: pages('releases', 'releases/migration') },
  { label: 'Contributing', collapsed: true, items: pages('contributing/local-setup', 'contributing/architecture', 'contributing/reading-the-code', 'contributing/testing', 'contributing/documentation', 'contributing/releases', 'contributing/mcp-integration') },
];

export function navigationErrors(publicSlugs, groups = navigation) {
  const errors = [];
  const seen = new Set();
  const available = new Set(publicSlugs);
  function visit(items) {
    for (const item of items) {
      if (item.items) visit(item.items);
      else {
        if (seen.has(item.slug)) errors.push(`Duplicate navigation page: ${item.slug}`);
        if (!available.has(item.slug)) errors.push(`Missing navigation page: ${item.slug}`);
        seen.add(item.slug);
      }
    }
  }
  visit(groups);
  for (const slug of available) if (!seen.has(slug)) errors.push(`Unlisted public page: ${slug}`);
  return errors;
}
