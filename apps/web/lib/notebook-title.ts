export function stripResearchSuffix(title: string): string {
  return title.replace(/\s*[·•]\s*研究\s*$/, '').trim();
}

export function normalizeNotebookTitle(title: string, fallback = '研究课题'): string {
  const clean = stripResearchSuffix(title).replace(/\s+/g, ' ').trim();
  return clean || fallback;
}
