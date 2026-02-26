import JSZip from 'jszip';
import type {
  IDocumentLoader,
  DocumentLoadResult,
  LoadOptions,
  PageInfo,
} from './types.js';

const TEXT_EXTENSIONS = new Set([
  'md',
  'markdown',
  'txt',
  'json',
  'yaml',
  'yml',
  'toml',
  'ini',
  'cfg',
  'conf',
  'csv',
  'tsv',
  'py',
  'js',
  'ts',
  'tsx',
  'jsx',
]);

const MAX_FILES = 60;
const MAX_FILE_CHARS = 120_000;

function extOf(path: string): string {
  const idx = path.lastIndexOf('.');
  if (idx < 0) return '';
  return path.slice(idx + 1).toLowerCase();
}

function cleanText(text: string): string {
  return text
    .replace(/^\uFEFF/, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .trim();
}

function isSkillLikePath(path: string): boolean {
  const lower = path.toLowerCase();
  return (
    lower.endsWith('/skill.md') ||
    lower === 'skill.md' ||
    lower.includes('/references/') ||
    lower.startsWith('references/')
  );
}

export class ZipSkillLoader implements IDocumentLoader {
  readonly supportedMimeTypes = ['application/zip', 'application/x-zip-compressed'];
  readonly supportedExtensions = ['zip'];

  async loadFromBuffer(buffer: Buffer, options?: LoadOptions): Promise<DocumentLoadResult> {
    const opts = { preserveStructure: true, ...options };
    const zip = await JSZip.loadAsync(buffer);
    const allEntries = Object.values(zip.files).filter((entry) => !entry.dir);

    const textEntries = allEntries
      .filter((entry) => {
        const ext = extOf(entry.name);
        return TEXT_EXTENSIONS.has(ext);
      })
      .sort((a, b) => {
        const aSkill = isSkillLikePath(a.name) ? 0 : 1;
        const bSkill = isSkillLikePath(b.name) ? 0 : 1;
        if (aSkill !== bSkill) return aSkill - bSkill;
        return a.name.localeCompare(b.name);
      })
      .slice(0, MAX_FILES);

    const pages: PageInfo[] = [];
    let content = '';
    let pageNumber = 1;

    for (const entry of textEntries) {
      let raw = await entry.async('string');
      raw = cleanText(raw);
      if (!raw) continue;
      if (raw.length > MAX_FILE_CHARS) {
        raw = `${raw.slice(0, MAX_FILE_CHARS)}\n\n...[TRUNCATED]`;
      }
      const block = `### FILE: ${entry.name}\n${raw}\n\n`;
      const startOffset = content.length;
      content += block;
      const endOffset = content.length;
      if (opts.preserveStructure) {
        pages.push({
          pageNumber,
          content: block,
          startOffset,
          endOffset,
          metadata: { path: entry.name },
        });
      }
      pageNumber += 1;
    }

    if (!content.trim()) {
      content =
        'Skill package contains no supported text files. Include SKILL.md and optional references/*.md files.';
      if (opts.preserveStructure) {
        pages.push({
          pageNumber: 1,
          content,
          startOffset: 0,
          endOffset: content.length,
        });
      }
    }

    return {
      content: content.trim(),
      mimeType: 'application/zip',
      structure: opts.preserveStructure ? { type: 'pages', pages } : undefined,
      metadata: {
        entryCount: allEntries.length,
        textEntryCount: textEntries.length,
      },
    };
  }

  canLoad(filePathOrMimeType: string): boolean {
    const lower = filePathOrMimeType.toLowerCase().trim();
    return (
      this.supportedMimeTypes.includes(lower) ||
      this.supportedExtensions.some((ext) => lower.endsWith(`.${ext}`))
    );
  }
}
