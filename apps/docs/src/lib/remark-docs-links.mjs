// Keep authored root-relative article links portable across static hosts and project sites.
export function remarkDocsLinks({ base = '/' } = {}) {
  const prefix = `/${base.split('/').filter(Boolean).join('/')}`;
  return (tree) => {
    const visit = (node) => {
      if (typeof node.url === 'string' && node.url.startsWith('/') && !node.url.startsWith('//')) {
        node.url = `${prefix === '/' ? '' : prefix}${node.url}`;
      }
      node.children?.forEach(visit);
    };
    visit(tree);
  };
}
