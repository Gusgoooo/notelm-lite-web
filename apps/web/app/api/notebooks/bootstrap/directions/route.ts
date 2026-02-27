import { NextResponse } from 'next/server';
import { and, db, eq, sourceChunks, sources } from 'db';
import { getNotebookAccess } from '@/lib/notebook-access';
import { getAgentSettings } from '@/lib/agent-settings';
import { getLatestResearchState, saveResearchState, type ResearchDirection } from '@/lib/research-state';

function extractTextFromContent(content: unknown): string {
  if (typeof content === 'string') return content.trim();
  if (!Array.isArray(content)) return '';
  const lines: string[] = [];
  for (const part of content) {
    if (!part || typeof part !== 'object') continue;
    const obj = part as { type?: unknown; text?: unknown };
    if (obj.type === 'text' && typeof obj.text === 'string') lines.push(obj.text);
  }
  return lines.join('\n').trim();
}

function tryParseJson(content: string): unknown {
  try {
    return JSON.parse(content.trim());
  } catch {
    const fenced = content.match(/```json\s*([\s\S]*?)```/i)?.[1];
    if (!fenced) return null;
    try {
      return JSON.parse(fenced.trim());
    } catch {
      return null;
    }
  }
}

function normalizeStars(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(1, Math.min(5, Math.round(value)));
  }
  if (typeof value === 'string') {
    const count = (value.match(/⭐/g) ?? []).length;
    if (count > 0) return Math.max(1, Math.min(5, count));
    const n = Number.parseInt(value, 10);
    if (Number.isFinite(n)) return Math.max(1, Math.min(5, n));
  }
  return 3;
}

function normalizeDirections(payload: unknown, topic: string): ResearchDirection[] {
  if (!payload || typeof payload !== 'object') return [];
  const raw = (payload as { directions?: unknown }).directions;
  if (!Array.isArray(raw)) return [];
  const out: ResearchDirection[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const title = String(row.title ?? row.topic ?? '').trim().slice(0, 80);
    const researchQuestion = String(row.researchQuestion ?? row.question ?? '').trim().slice(0, 220);
    const coreVariables = String(row.coreVariables ?? row.variables ?? '').trim().slice(0, 120);
    const researchMethod = String(row.researchMethod ?? row.method ?? '').trim().slice(0, 120);
    const dataSourceAccess = String(row.dataSourceAccess ?? row.dataSources ?? '').trim().slice(0, 120);
    const trendHeat = String(row.trendHeat ?? row.trend ?? '').trim().slice(0, 80);
    if (!title || !researchQuestion) continue;
    out.push({
      id: `dir_${out.length + 1}`,
      title,
      researchQuestion,
      coreVariables: coreVariables || '自变量 / 因变量需进一步界定',
      researchMethod: researchMethod || '混合方法（定量 + 定性）',
      dataSourceAccess: dataSourceAccess || '可通过公开数据库和行业报告收集',
      difficultyStars: normalizeStars(row.difficultyStars ?? row.difficulty ?? 3),
      trendHeat: trendHeat || '中高热度，近三年持续增长',
    });
    if (out.length >= 10) break;
  }
  if (out.length >= 5) return out;

  return [
    {
      id: 'dir_fallback_1',
      title: `${topic}中的关键机制识别`,
      researchQuestion: `在${topic}场景下，最影响结果表现的关键机制是什么？`,
      coreVariables: '核心机制变量 / 结果变量',
      researchMethod: '文献综述 + 计量分析',
      dataSourceAccess: '公开论文与行业数据可获取',
      difficultyStars: 3,
      trendHeat: '近三年持续升温',
    },
    {
      id: 'dir_fallback_2',
      title: `${topic}的应用效果评估`,
      researchQuestion: `${topic}在不同人群或场景下的效果差异是否显著？`,
      coreVariables: '应用强度 / 绩效指标',
      researchMethod: '准实验 / 对比研究',
      dataSourceAccess: '需要结合公开数据与小规模调研',
      difficultyStars: 4,
      trendHeat: '高热度',
    },
    {
      id: 'dir_fallback_3',
      title: `${topic}的风险与治理`,
      researchQuestion: `${topic}推广中最常见的风险点是什么，如何建立治理框架？`,
      coreVariables: '风险暴露 / 治理策略',
      researchMethod: '案例研究 + 专家访谈',
      dataSourceAccess: '案例可收集，访谈成本中等',
      difficultyStars: 3,
      trendHeat: '中高热度',
    },
    {
      id: 'dir_fallback_4',
      title: `${topic}的区域/行业异质性`,
      researchQuestion: `${topic}在不同区域或行业中的效果为何会出现差异？`,
      coreVariables: '地区特征 / 行业特征 / 输出结果',
      researchMethod: '分组回归 + 交互项分析',
      dataSourceAccess: '多源公开数据可拼接',
      difficultyStars: 4,
      trendHeat: '中等偏高',
    },
    {
      id: 'dir_fallback_5',
      title: `${topic}未来三年趋势预测`,
      researchQuestion: `基于现有证据，${topic}未来三年的关键演化方向是什么？`,
      coreVariables: '趋势指标 / 政策与技术因素',
      researchMethod: '趋势分析 + 德尔菲法',
      dataSourceAccess: '公开资料较易获取',
      difficultyStars: 2,
      trendHeat: '高热度',
    },
  ];
}

async function generateDirections(input: {
  topic: string;
  context: string;
}): Promise<ResearchDirection[]> {
  const settings = await getAgentSettings();
  const apiKey = settings.openrouterApiKey.trim();
  const baseUrl = settings.openrouterBaseUrl.trim() || 'https://openrouter.ai/api/v1';
  const model = (settings.models.summary || process.env.OPENROUTER_CHAT_MODEL || 'openrouter/auto').trim();
  if (!apiKey) throw new Error('OpenRouter API key is not configured in admin settings');

  const response = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      temperature: 0.4,
      messages: [
        {
          role: 'system',
          content:
            '你是资深研究选题顾问。请输出 JSON，格式为 {"directions":[...]}，不要输出 markdown，不要输出额外说明。',
        },
        {
          role: 'user',
          content:
            `研究主题：${input.topic}\n\n` +
            `参考材料（来自联网检索来源摘要）：\n${input.context}\n\n` +
            `请延展 5-10 个“可直接开题”的研究方向，每个方向包含字段：\n` +
            `title, researchQuestion, coreVariables, researchMethod, dataSourceAccess, difficultyStars(1-5), trendHeat。\n` +
            `要求：\n` +
            `1) 研究问题必须可提问且可验证；\n` +
            `2) 方法要具体（定量/定性/实验/混合）；\n` +
            `3) 数据可得性要给出现实判断；\n` +
            `4) difficultyStars 必须为数字；\n` +
            `5) 全部使用简体中文。`,
        },
      ],
      stream: false,
    }),
  });
  const raw = await response.text();
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    payload = raw;
  }
  if (!response.ok) {
    const message =
      typeof payload === 'object' &&
      payload &&
      'error' in payload &&
      payload.error &&
      typeof payload.error === 'object' &&
      'message' in payload.error &&
      typeof payload.error.message === 'string'
        ? payload.error.message
        : `HTTP ${response.status}`;
    throw new Error(`Generate directions failed: ${message}`);
  }
  const content = extractTextFromContent(
    (payload as { choices?: Array<{ message?: { content?: unknown } }> }).choices?.[0]?.message?.content ?? ''
  );
  const parsed = tryParseJson(content);
  return normalizeDirections(parsed, input.topic);
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const notebookId = typeof body?.notebookId === 'string' ? body.notebookId.trim() : '';
    const topic = typeof body?.topic === 'string' ? body.topic.trim() : '';
    if (!notebookId || !topic) {
      return NextResponse.json({ error: 'notebookId and topic are required' }, { status: 400 });
    }

    const access = await getNotebookAccess(notebookId);
    if (!access.notebook) return NextResponse.json({ error: 'Notebook not found' }, { status: 404 });
    if (!access.canEditSources) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const stateRow = await getLatestResearchState(notebookId);
    const phaseBefore = stateRow?.state.phase ?? 'collecting';
    if (phaseBefore === 'ready' && stateRow?.state.directions.length) {
      return NextResponse.json({
        notebookId,
        directions: stateRow.state.directions,
        phase: stateRow.state.phase,
      });
    }

    const chunks = await db
      .select({
        content: sourceChunks.content,
      })
      .from(sourceChunks)
      .innerJoin(sources, eq(sourceChunks.sourceId, sources.id))
      .where(and(eq(sources.notebookId, notebookId), eq(sources.status, 'READY')))
      .limit(80);
    const context = chunks.map((row) => row.content).join('\n\n').slice(0, 36_000);

    const directions = await generateDirections({
      topic,
      context: context || `主题：${topic}`,
    });

    const now = new Date().toISOString();
    await saveResearchState({
      notebookId,
      conversationId: stateRow?.conversationId,
      state: {
        topic,
        phase: 'select_direction',
        directions,
        createdAt: stateRow?.state.createdAt ?? now,
        updatedAt: now,
      },
    });

    return NextResponse.json({
      notebookId,
      phase: 'select_direction',
      directions,
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to generate directions' },
      { status: 500 }
    );
  }
}

