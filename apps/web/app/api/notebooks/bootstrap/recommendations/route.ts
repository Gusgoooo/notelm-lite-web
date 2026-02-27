import { NextResponse } from 'next/server';
import { getAgentSettings } from '@/lib/agent-settings';

const FALLBACK_TOPICS = [
  'AIGC 与设计协作流程优化',
  '教育领域 AI 应用的学习效果评估',
  '乡村振兴中的数据治理与数字平台',
  '新媒体传播中的生成式内容可信度',
  '多模态大模型在知识管理中的落地',
  '智能体产品的人机协作体验设计',
  'AI 时代的科研方法与研究伦理',
  '学术论文自动化综述与证据整合',
  '行业知识库问答系统的质量评估',
  '跨学科研究中的 AI 方法迁移',
];

function extractTextFromContent(content: unknown): string {
  if (typeof content === 'string') return content.trim();
  if (!Array.isArray(content)) return '';
  const lines: string[] = [];
  for (const part of content) {
    if (!part || typeof part !== 'object') continue;
    const row = part as { type?: unknown; text?: unknown };
    if (row.type === 'text' && typeof row.text === 'string') lines.push(row.text);
  }
  return lines.join('\n').trim();
}

function tryParseJson(input: string): unknown {
  try {
    return JSON.parse(input.trim());
  } catch {
    const fenced = input.match(/```json\s*([\s\S]*?)```/i)?.[1];
    if (!fenced) return null;
    try {
      return JSON.parse(fenced.trim());
    } catch {
      return null;
    }
  }
}

function normalizeTopics(payload: unknown): string[] {
  if (!payload || typeof payload !== 'object') return [];
  const raw = (payload as { topics?: unknown }).topics;
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== 'string') continue;
    const topic = item.replace(/\s+/g, ' ').trim().slice(0, 48);
    if (!topic || seen.has(topic)) continue;
    seen.add(topic);
    out.push(topic);
    if (out.length >= 8) break;
  }
  return out;
}

function pickFallback(count: number): string[] {
  const shuffled = [...FALLBACK_TOPICS].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, Math.max(4, Math.min(8, count)));
}

export async function GET() {
  try {
    const settings = await getAgentSettings();
    const apiKey = settings.openrouterApiKey.trim();
    const baseUrl = settings.openrouterBaseUrl.trim() || 'https://openrouter.ai/api/v1';
    const model = (settings.models.summary || process.env.OPENROUTER_CHAT_MODEL || 'openrouter/auto').trim();
    if (!apiKey) {
      return NextResponse.json({ topics: pickFallback(6), fallback: true });
    }

    const response = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        temperature: 0.8,
        messages: [
          {
            role: 'system',
            content:
              '你是研究选题助手。只输出 JSON：{"topics":["..."]}，不要输出任何额外文本。',
          },
          {
            role: 'user',
            content:
              '请给我 6-8 个近期热门、适合研究开题的方向，要求：\n' +
              '1) 全部简体中文；\n' +
              '2) 领域尽量多样（AIGC、教育、传播、产业、治理等）；\n' +
              '3) 每个方向一句短语（不超过24字）；\n' +
              '4) 仅返回 JSON。',
          },
        ],
      }),
    });
    const raw = await response.text();
    if (!response.ok) {
      return NextResponse.json({ topics: pickFallback(6), fallback: true });
    }
    let payload: unknown;
    try {
      payload = JSON.parse(raw);
    } catch {
      payload = raw;
    }
    const content = extractTextFromContent(
      (payload as { choices?: Array<{ message?: { content?: unknown } }> }).choices?.[0]?.message?.content ?? ''
    );
    const parsed = tryParseJson(content);
    const topics = normalizeTopics(parsed);
    if (topics.length < 4) {
      return NextResponse.json({ topics: pickFallback(6), fallback: true });
    }
    return NextResponse.json({ topics, fallback: false });
  } catch {
    return NextResponse.json({ topics: pickFallback(6), fallback: true });
  }
}

