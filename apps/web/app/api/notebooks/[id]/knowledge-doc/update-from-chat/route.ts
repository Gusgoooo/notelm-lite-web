import { NextResponse } from 'next/server';
import { and, db, eq, notes } from 'db';
import { chat } from 'shared';
import {
  getDefaultKnowledgeDocScenarioState,
  normalizeKnowledgeDocScenarioState,
  resolveKnowledgeDocScenario,
} from '@/lib/knowledge-doc-scenarios';
import {
  countKnowledgeDocUnits,
  ensureKnowledgeDocMarkdown,
  KNOWLEDGE_DOC_MARKDOWN_GUIDE,
  normalizeKnowledgeDocMarkdown,
} from '@/lib/knowledge-doc-markdown';
import { getNotebookAccess } from '@/lib/notebook-access';
import { KNOWLEDGE_DOC_SCENARIO_STATE_NOTE_TITLE } from '@/lib/knowledge-unit';

function parseScenarioState(raw: string | null | undefined) {
  if (!raw) return getDefaultKnowledgeDocScenarioState();
  try {
    return normalizeKnowledgeDocScenarioState(JSON.parse(raw));
  } catch {
    return getDefaultKnowledgeDocScenarioState();
  }
}

function hasExplicitCondenseIntent(text: string): boolean {
  if (!text.trim()) return false;
  return /精简|精炼|缩短|压缩|删减|减少|简化|浓缩|更短|简洁一点|控制字数|少写|短一点/i.test(text);
}

function hasExplicitExpandIntent(text: string): boolean {
  if (!text.trim()) return false;
  const hasExpandSignal =
    /补充|补全|扩写|展开|详细|深入|更完整|更全面|丰富|增加内容|多写|写长一点|详细一点|展开说|再补一些/i.test(
      text
    );
  const hasNegation =
    /(不要|不用|无需|别)(?:.{0,4})(补充|补全|扩写|展开|详细|深入|增加|多写|写长|丰富)/i.test(text);
  return hasExpandSignal && !hasNegation;
}

type KnowledgeDocLengthMode = 'condense' | 'balanced' | 'expand';

function resolveKnowledgeDocLengthMode(text: string): KnowledgeDocLengthMode {
  const preferCondense = hasExplicitCondenseIntent(text);
  const preferExpand = hasExplicitExpandIntent(text);
  if (preferCondense && !preferExpand) return 'condense';
  if (preferExpand && !preferCondense) return 'expand';
  return 'balanced';
}

function getKnowledgeDocLengthBudget(
  currentContent: string,
  structure: string,
  mode: KnowledgeDocLengthMode
) {
  const currentUnits = countKnowledgeDocUnits(currentContent);
  if (currentUnits > 0) {
    if (mode === 'condense') {
      const min = Math.max(120, Math.round(currentUnits * 0.68));
      const max = Math.max(min + 32, Math.round(currentUnits * 0.94));
      return {
        baseline: currentUnits,
        min,
        max,
        hardMax: max,
      };
    }
    if (mode === 'expand') {
      const min = currentUnits + Math.max(48, Math.round(currentUnits * 0.1));
      const max = currentUnits + Math.max(220, Math.round(currentUnits * 0.42));
      const hardMax = max + Math.max(180, Math.round(currentUnits * 0.28));
      return {
        baseline: currentUnits,
        min,
        max: Math.max(min + 80, max),
        hardMax: Math.max(max + 120, hardMax),
      };
    }
    const min = currentUnits + Math.max(24, Math.round(currentUnits * 0.05));
    const max = currentUnits + Math.max(120, Math.round(currentUnits * 0.18));
    const hardMax = max + Math.max(140, Math.round(currentUnits * 0.2));
    return {
      baseline: currentUnits,
      min,
      max: Math.max(min + 48, max),
      hardMax: Math.max(max + 100, hardMax),
    };
  }

  const structureUnits = countKnowledgeDocUnits(structure);
  const baseline = Math.max(300, Math.min(760, Math.round(structureUnits * 2.2)));
  if (mode === 'condense') {
    const min = Math.max(180, Math.round(baseline * 0.7));
    const max = Math.max(260, Math.round(baseline * 0.95));
    return {
      baseline,
      min,
      max,
      hardMax: max,
    };
  }
  if (mode === 'expand') {
    const min = Math.max(260, Math.round(baseline * 1.0));
    const max = Math.max(420, Math.round(baseline * 1.5));
    const hardMax = Math.max(520, Math.round(baseline * 1.78));
    return {
      baseline,
      min,
      max,
      hardMax,
    };
  }
  return {
    baseline,
    min: Math.max(220, Math.round(baseline * 0.9)),
    max: Math.max(360, Math.round(baseline * 1.24)),
    hardMax: Math.max(420, Math.round(baseline * 1.42)),
  };
}

function normalizeForSelectionCompare(raw: string): string {
  return raw
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/\[(\d{1,3})]/g, ' ')
    .replace(/[#>*`~_|-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/gi, '');
}

function isMarkdownTableSeparatorLine(line: string): boolean {
  return /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/.test(line.trim());
}

function isMarkdownTableLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed || !trimmed.includes('|')) return false;
  if (isMarkdownTableSeparatorLine(trimmed)) return true;
  return /^\|?.+\|.+\|?$/.test(trimmed);
}

function extractSelectionAnchors(highlighted: string): string[] {
  const normalized = normalizeKnowledgeDocMarkdown(highlighted);
  return normalized
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length >= 10)
    .filter((line) => !line.startsWith('#'))
    .filter((line) => !isMarkdownTableLine(line))
    .map((line) => line.replace(/^[-*+]\s+/, ''))
    .slice(0, 5);
}

function contentContainsSelectionAnchors(content: string, highlighted: string): boolean {
  const contentNorm = normalizeForSelectionCompare(content);
  const anchors = extractSelectionAnchors(highlighted);
  if (anchors.length === 0) return false;
  return anchors.some((anchor) => {
    const anchorNorm = normalizeForSelectionCompare(anchor);
    return anchorNorm.length >= 8 && contentNorm.includes(anchorNorm);
  });
}

function findSelectionTargetSection(markdown: string): string {
  const headings = markdown
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^##\s+/.test(line))
    .map((line) => line.replace(/^##\s+/, '').trim());
  if (headings.length === 0) return '核心要点';
  const preferred = headings.find((heading) => /(证据|事实|数据|结论|要点|补充|摘要|引用|摘录)/.test(heading));
  return preferred ?? headings[0];
}

function splitSelectionMaterial(markdown: string): { tableBlocks: string[]; quoteLines: string[] } {
  const lines = markdown.split('\n').map((line) => line.trimEnd());
  const tableBlocks: string[] = [];
  const quoteLines: string[] = [];

  let index = 0;
  while (index < lines.length) {
    const line = lines[index]?.trim() ?? '';
    const nextLine = lines[index + 1]?.trim() ?? '';
    if (isMarkdownTableLine(line) && isMarkdownTableSeparatorLine(nextLine)) {
      const tableLines: string[] = [line, nextLine];
      let cursor = index + 2;
      while (cursor < lines.length && isMarkdownTableLine(lines[cursor] ?? '')) {
        tableLines.push((lines[cursor] ?? '').trim());
        cursor += 1;
      }
      tableBlocks.push(tableLines.join('\n').trim());
      index = cursor;
      continue;
    }
    if (line && !line.startsWith('#') && !isMarkdownTableLine(line) && !isMarkdownTableSeparatorLine(line)) {
      const clean = line.replace(/^[-*+]\s+/, '').trim();
      if (clean) {
        quoteLines.push(clean);
      }
    }
    index += 1;
  }

  return {
    tableBlocks: tableBlocks.slice(0, 2),
    quoteLines: quoteLines.slice(0, 6),
  };
}

function mergeSelectionMaterialIntoDoc(currentContent: string, highlightedMaterials: string): string {
  const base = normalizeKnowledgeDocMarkdown(currentContent);
  const fallbackBase = base || '# 知识文档\n\n## 核心要点\n- 待补充';
  const normalizedHighlighted = normalizeKnowledgeDocMarkdown(highlightedMaterials);
  if (!normalizedHighlighted) return fallbackBase;

  const { tableBlocks, quoteLines } = splitSelectionMaterial(normalizedHighlighted);
  if (tableBlocks.length === 0 && quoteLines.length === 0) return fallbackBase;

  const section = findSelectionTargetSection(fallbackBase);
  const lines = fallbackBase.split('\n');
  const headingIndex = lines.findIndex((line) => line.trim().toLowerCase() === `## ${section}`.toLowerCase());
  const sectionMissing = headingIndex < 0;

  let scopedLines = lines;
  let scopedHeadingIndex = headingIndex;
  if (sectionMissing) {
    scopedLines = [...lines, '', `## ${section}`];
    scopedHeadingIndex = scopedLines.length - 1;
  }

  let insertAt = scopedLines.length;
  for (let i = scopedHeadingIndex + 1; i < scopedLines.length; i += 1) {
    if (/^##\s+/.test((scopedLines[i] ?? '').trim())) {
      insertAt = i;
      break;
    }
  }

  const existingSectionText = scopedLines.slice(scopedHeadingIndex + 1, insertAt).join('\n');
  let existingNorm = normalizeForSelectionCompare(existingSectionText);
  const toInsert: string[] = [];

  for (const table of tableBlocks) {
    const tableNorm = normalizeForSelectionCompare(table);
    if (!tableNorm || existingNorm.includes(tableNorm)) continue;
    if (toInsert.length > 0 && toInsert[toInsert.length - 1] !== '') {
      toInsert.push('');
    }
    toInsert.push(table);
    toInsert.push('');
    existingNorm += tableNorm;
  }

  const freshQuoteLines: string[] = [];
  for (const line of quoteLines) {
    const lineNorm = normalizeForSelectionCompare(line);
    if (!lineNorm || existingNorm.includes(lineNorm)) continue;
    freshQuoteLines.push(line);
    existingNorm += lineNorm;
  }
  if (freshQuoteLines.length > 0) {
    if (toInsert.length > 0 && toInsert[toInsert.length - 1] !== '') {
      toInsert.push('');
    }
    toInsert.push('- 划选原文摘录');
    for (const line of freshQuoteLines) {
      toInsert.push(`  - ${line}`);
    }
  }

  if (toInsert.length === 0) {
    return fallbackBase;
  }

  const merged = [...scopedLines.slice(0, insertAt), ...toInsert, ...scopedLines.slice(insertAt)]
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return normalizeKnowledgeDocMarkdown(merged);
}

async function compressKnowledgeDocToBudget(
  markdown: string,
  structure: string,
  maxUnits: number
) {
  const normalized = normalizeKnowledgeDocMarkdown(markdown);
  if (!normalized) return normalized;
  if (countKnowledgeDocUnits(normalized) <= maxUnits) return normalized;

  const { content } = await chat([
    {
      role: 'system',
      content: `你是知识文档压缩整理助手。
请在不改变结构顺序的前提下，压缩已有知识文档。

要求：
1. 严格输出 Markdown。
2. 必须沿用既有结构和标题层级，不要新增结构外章节。
3. 优先删除重复、解释性套话、长句和弱相关细节。
4. 优先保留结论、关键事实、指标、负责人、风险和待补充项。
5. 输出长度必须控制在 ${maxUnits} 个字符单元以内。

${KNOWLEDGE_DOC_MARKDOWN_GUIDE}`,
    },
    {
      role: 'user',
      content:
        `【必须遵循的结构】\n${structure}\n\n` +
        `【待压缩文档】\n${normalized}\n\n` +
        `请输出压缩后的完整知识文档。`,
    },
  ]);

  return normalizeKnowledgeDocMarkdown(content ?? '') || normalized;
}

async function enrichKnowledgeDocToBudget(input: {
  markdown: string;
  structure: string;
  minUnits: number;
  maxUnits: number;
}): Promise<string> {
  const normalized = normalizeKnowledgeDocMarkdown(input.markdown);
  if (!normalized) return normalized;
  if (countKnowledgeDocUnits(normalized) >= input.minUnits) return normalized;

  const { content } = await chat([
    {
      role: 'system',
      content: `你是知识文档增量补全助手。
请在不改变结构顺序和标题层级的前提下，适度补充当前文档。

要求：
1. 严格输出 Markdown。
2. 必须沿用既有结构，禁止新增结构外章节。
3. 只补充高价值信息：关键事实、判断依据、执行细节、风险与待补充项。
4. 句子保持简洁，不要空话或重复。
5. 输出长度目标：${input.minUnits}-${input.maxUnits} 字符单元。

${KNOWLEDGE_DOC_MARKDOWN_GUIDE}`,
    },
    {
      role: 'user',
      content:
        `【必须遵循的结构】\n${input.structure}\n\n` +
        `【待补全文档】\n${normalized}\n\n` +
        `请输出补全后的完整知识文档。`,
    },
  ]);

  return normalizeKnowledgeDocMarkdown(content ?? '') || normalized;
}

/**
 * Given current doc content and recent conversation, ask LLM to produce
 * an updated knowledge document in structured Markdown.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: notebookId } = await params;
  try {
    const access = await getNotebookAccess(notebookId);
    if (!access.notebook) {
      return NextResponse.json({ error: 'Notebook not found' }, { status: 404 });
    }
    if (!access.isOwner) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    const body = await request.json();
    const currentContent = ensureKnowledgeDocMarkdown(
      typeof body?.currentContent === 'string' ? body.currentContent : ''
    );
    const lastUserMessage = typeof body?.lastUserMessage === 'string' ? body.lastUserMessage : '';
    const lastAssistantMessage =
      typeof body?.lastAssistantMessage === 'string' ? body.lastAssistantMessage : '';
    const highlightedMaterials =
      typeof body?.highlightedMaterials === 'string' ? body.highlightedMaterials : '';
    const highlightedMode = body?.highlightedMode === 'selection' ? 'selection' : 'general';
    const userEditedHint =
      typeof body?.userEditedHint === 'string' ? body.userEditedHint : '';
    const lengthMode = resolveKnowledgeDocLengthMode(lastUserMessage);

    const [scenarioRow] = await db
      .select({ content: notes.content })
      .from(notes)
      .where(and(eq(notes.notebookId, notebookId), eq(notes.title, KNOWLEDGE_DOC_SCENARIO_STATE_NOTE_TITLE)))
      .limit(1);
    const scenarioState = parseScenarioState(scenarioRow?.content);
    const activeScenario = resolveKnowledgeDocScenario(scenarioState, scenarioState.activeScenarioId);

    if (!lastUserMessage.trim() && !lastAssistantMessage.trim() && !highlightedMaterials.trim()) {
      return NextResponse.json(
        { error: 'No conversation content to merge' },
        { status: 400 }
      );
    }

    const lengthBudget = getKnowledgeDocLengthBudget(
      currentContent,
      activeScenario.structure,
      lengthMode
    );
    const selectionUpdate = highlightedMode === 'selection' && highlightedMaterials.trim().length > 0;

    const systemPrompt = `你是一个知识文档整理助手。根据用户与 AI 的对话内容，更新「当前知识文档」。
要求：
1. 将对话中的关键信息、结论、事实整合进文档，保持结构清晰（可分段、分条）。
2. 不要编造对话中未出现的内容。
3. 输出 Markdown，可使用 #、##、###、无序列表、加粗、表格等结构化格式。
4. 当前知识文档输入始终是 Markdown，请保持结构兼容并完整输出 Markdown。
5. 当前知识文档是当前版本下的权威版本。你必须把更新理解为对现有文档做增删改查，而不是简单追加内容。
6. 如果提供了“突出资料”，请将它与用户问题和助手回答一起吸收进文档，优先整理成可复用的结论、事实依据、要点列表。
7. 当前文档中已有内容视为用户撰写或修改过的，请尽量保留并在其基础上补充、替换、合并或删除，避免大段重写。
8. 优先整理成适合右侧知识文档面板直接渲染的结构化内容，例如标题、小节、要点列表。
9. 如果存在项目说明，请先从项目说明中推断最合适的章节结构，再严格按该结构进行增量更新；项目说明也会决定回答风格、重点和引导方式。
10. 最高优先级规则：若对话或突出资料中出现“当前知识文档尚未覆盖”的新概念/新证据（术语、关键事实、指标、结论、来源依据），必须优先插入到最匹配的章节；禁止遗漏。
11. 字数策略必须与用户意图一致：明确要求精简时再压缩；默认做平衡优化；明确要求补充/扩写时允许明显增量。
12. 如果新信息与旧信息重复或冲突，优先合并或替换旧内容；如果某段已经过时或弱相关，应删除而不是保留。
13. 每个二级模块优先控制在 2-6 条要点或 1-3 个短段落内，句子尽量短。
14. 增量更新时默认保留现有内容，仅修改相关章节，不要大幅删减文档长度。${
  selectionUpdate
    ? '\n15. 本轮是“划词更新”，突出资料属于高权重原文。必须优先保留原文表达，少改写、少压缩，并把可用的 Markdown 表格原样纳入文档。'
    : ''
}${
  userEditedHint
    ? `\n16. 以下内容为用户明确标注的手动编辑，请务必保留不改动：\n${userEditedHint}`
    : ''
}

${KNOWLEDGE_DOC_MARKDOWN_GUIDE}`;

    const userPrompt =
      `【当前知识文档（Markdown）】\n${currentContent || '(空)'}\n\n` +
      `【当前场景】\n${activeScenario.label}\n\n` +
      `【当前项目说明】\n${activeScenario.structure}\n\n` +
      `【更新来源类型】\n${selectionUpdate ? '划词更新（高权重原文）' : '常规对话更新'}\n\n` +
      `【当前长度策略】\n${
        lengthMode === 'condense'
          ? `用户明确要求精简：当前版本约 ${lengthBudget.baseline} 个字符单元，本次建议控制在 ${lengthBudget.min}-${lengthBudget.max} 之间，超过 ${lengthBudget.hardMax} 将触发压缩。`
          : lengthMode === 'expand'
            ? `用户明确要求补充：当前版本约 ${lengthBudget.baseline} 个字符单元，本次建议扩展到 ${lengthBudget.min}-${lengthBudget.max} 之间，仅在超过 ${lengthBudget.hardMax} 时压缩。`
            : `默认平衡策略：当前版本约 ${lengthBudget.baseline} 个字符单元，本次建议在 ${lengthBudget.min}-${lengthBudget.max} 之间，允许自然波动，仅在超过 ${lengthBudget.hardMax} 时压缩。`
      }\n\n` +
      `【用户问题 / 用户要求】\n${lastUserMessage || '(空)'}\n\n` +
      `【助手回答】\n${lastAssistantMessage || '(空)'}\n\n` +
      `【突出资料】\n${highlightedMaterials || '(空)'}\n\n` +
      `请综合以上内容，输出更新后的完整知识文档内容（Markdown）。
操作优先级：
1. 先识别“当前文档未覆盖”的新概念/新证据，并优先插入到对应章节。
2. 再根据项目说明确定最合适的章节结构，定位应修改的模块。
3. 优先改写、替换、合并已有内容。
4. 只有结构中缺少必要信息时，才新增内容；若用户要求补充/扩写，应优先补齐依据、细节和待办。
5. 删除重复、过时、冲突或弱相关内容。
6. 在保证准确前提下，默认让文档更完整；仅当用户明确要求精简时才缩短。
7. 若本轮为划词更新，优先保留突出资料中的原文和表格，避免改写成过度抽象的短句。`;

    const { content: suggestedContent } = await chat([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ]);

    let trimmed = normalizeKnowledgeDocMarkdown(suggestedContent ?? '');
    if (trimmed) {
      if (lengthMode !== 'condense' && countKnowledgeDocUnits(trimmed) < lengthBudget.min) {
        trimmed = await enrichKnowledgeDocToBudget({
          markdown: trimmed,
          structure: activeScenario.structure,
          minUnits: lengthBudget.min,
          maxUnits: lengthBudget.max,
        });
      }
      const compressThreshold = lengthMode === 'condense' ? lengthBudget.max : lengthBudget.hardMax;
      if (countKnowledgeDocUnits(trimmed) > compressThreshold) {
        trimmed = await compressKnowledgeDocToBudget(trimmed, activeScenario.structure, compressThreshold);
      }
    }
    if (selectionUpdate) {
      const baselineUnits = countKnowledgeDocUnits(currentContent);
      const nextUnits = countKnowledgeDocUnits(trimmed || currentContent);
      const shrunkTooMuch = baselineUnits > 0 && nextUnits < Math.round(baselineUnits * 0.88);
      const containsAnchors = contentContainsSelectionAnchors(trimmed || '', highlightedMaterials);
      if (shrunkTooMuch || !containsAnchors) {
        const mergeBase = shrunkTooMuch ? currentContent : trimmed || currentContent;
        trimmed = mergeSelectionMaterialIntoDoc(mergeBase, highlightedMaterials);
      }
    }
    return NextResponse.json({
      suggestedContent: trimmed || currentContent,
    });
  } catch (e) {
    console.error(e);
    return NextResponse.json(
      { error: 'Failed to update knowledge document from chat' },
      { status: 500 }
    );
  }
}
