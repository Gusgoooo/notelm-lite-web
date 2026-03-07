import { NextResponse } from 'next/server';
import { chat } from 'shared';

type GuidePayload = {
  lead: string;
  questions: string[];
};

function normalizeTopic(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, 160);
}

function inferScenario(topic: string): 'okr' | 'prd' | 'prompt' | 'analysis' | 'learning' | 'general' {
  const normalized = topic.toLowerCase();
  if (/okr|目标|关键结果/.test(normalized)) return 'okr';
  if (/prd|产品需求|需求文档|产品方案/.test(normalized)) return 'prd';
  if (/prompt|提示词|指令/.test(normalized)) return 'prompt';
  if (/报告|分析|复盘|洞察|研究/.test(normalized)) return 'analysis';
  if (/学习|课程|入门|知识|教程/.test(normalized)) return 'learning';
  return 'general';
}

function ensureQuestionMark(value: string): string {
  const trimmed = value.replace(/\s+/g, ' ').trim().replace(/^[\d一二三四五六七八九十]+[.)、\s-]*/, '');
  if (!trimmed) return '';
  const normalized = trimmed.replace(/[。；;]+$/g, '');
  return /[？?]$/.test(normalized) ? normalized.replace(/\?$/, '？') : `${normalized}？`;
}

function fallbackGuide(topic: string): GuidePayload {
  const scenario = inferScenario(topic);
  if (scenario === 'okr') {
    return {
      lead: '先从这些问题开始就够了。',
      questions: [
        '这个 OKR 的目标是什么？',
        '关键结果准备怎么衡量？',
        '这次 OKR 的周期和负责人是谁？',
      ],
    };
  }
  if (scenario === 'prd') {
    return {
      lead: '先从这些问题开始就够了。',
      questions: [
        '这个需求主要给谁用？',
        '最核心的使用场景是什么？',
        '上线后看什么指标判断效果？',
      ],
    };
  }
  if (scenario === 'prompt') {
    return {
      lead: '先从这些问题开始就够了。',
      questions: [
        '这个 Prompt 要完成什么任务？',
        '输入里会包含哪些信息？',
        '你希望输出是什么格式？',
      ],
    };
  }
  if (scenario === 'analysis') {
    return {
      lead: '先从这些问题开始就够了。',
      questions: [
        '这次最想分析的问题是什么？',
        '你最关心哪些比较维度？',
        '这份分析最后要支持什么决策？',
      ],
    };
  }
  if (scenario === 'learning') {
    return {
      lead: '先从这些问题开始就够了。',
      questions: [
        '你现在的基础大概是什么水平？',
        '这次最想学会哪一部分？',
        '你更想要笔记、案例还是步骤拆解？',
      ],
    };
  }
  return {
    lead: '先从这些问题开始就够了。',
    questions: [
      `${topic} 主要要解决什么问题？`,
      '这件事最重要的目标是什么？',
      '现在已经有哪些已知信息？',
    ],
  };
}

function parseGuideResponse(raw: string): GuidePayload | null {
  const trimmed = raw
    .trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '');
  const jsonStart = trimmed.indexOf('{');
  const jsonEnd = trimmed.lastIndexOf('}');
  if (jsonStart < 0 || jsonEnd <= jsonStart) return null;
  try {
    const parsed = JSON.parse(trimmed.slice(jsonStart, jsonEnd + 1)) as Partial<GuidePayload>;
    const lead = typeof parsed.lead === 'string' ? parsed.lead.trim() : '';
    const questions = Array.isArray(parsed.questions)
      ? parsed.questions
          .filter((item): item is string => typeof item === 'string')
          .map((item) => ensureQuestionMark(item))
          .filter(Boolean)
          .slice(0, 3)
      : [];
    if (!lead || questions.length === 0) return null;
    return { lead, questions };
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const topic = normalizeTopic(body?.topic);
    if (!topic) {
      return NextResponse.json({ error: 'topic is required' }, { status: 400 });
    }

    const fallback = fallbackGuide(topic);
    try {
      const { content } = await chat([
        {
          role: 'system',
          content:
            '你是产品里的引导问答助手。请根据用户在首页输入的主题，输出 3 个中文推荐问题，帮助用户补充生成知识文档所需的关键信息。要求：1. 问题要简短、直接、容易点击发送，尽量一句话说清。2. 不要写复杂反问，不要使用“如果我要…/为了让我…/我还需要先…”这类绕的表达。3. 优先识别场景，如 OKR、PRD、Prompt、分析报告、知识学习。4. 不要谈来源分析，不要提论文对比洞察，不要输出解释。5. 只输出 JSON，对象格式为 {"lead":"一句16字内的引导语","questions":["问题1","问题2","问题3"]}。',
        },
        {
          role: 'user',
          content: `主题：${topic}`,
        },
      ]);
      const parsed = parseGuideResponse(content);
      if (parsed) {
        return NextResponse.json(parsed);
      }
    } catch {
      // fall back to deterministic prompts
    }

    return NextResponse.json(fallback);
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'Failed to build onboarding questions' }, { status: 500 });
  }
}
