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
      lead: '为了更快形成可落地的 OKR，建议先把目标背景和衡量口径聊清楚。',
      questions: [
        '这个 OKR 对应的项目背景、阶段目标和负责人范围是什么？',
        '你最希望优先拉动的结果指标是什么，当前基线和目标值大概是多少？',
        '这次 OKR 有哪些关键约束，例如时间、资源、依赖团队或风险？',
      ],
    };
  }
  if (scenario === 'prd') {
    return {
      lead: '先把用户、场景和验证标准补齐，后续更容易生成可用的 PRD 初稿。',
      questions: [
        '这份 PRD 面向的核心用户是谁，他们当前最主要的痛点是什么？',
        '你希望优先解决的关键使用场景和目标动作分别是什么？',
        '这次方案上线后，你最看重哪些验证指标或业务结果？',
      ],
    };
  }
  if (scenario === 'prompt') {
    return {
      lead: '先明确任务目标和输出要求，我会边聊边帮你收敛成可复用的 Prompt 结构。',
      questions: [
        '你想让模型完成的核心任务是什么，最好给一个具体使用场景？',
        '你期望输入有哪些已知信息，输出又要满足哪些格式或风格要求？',
        '这条 Prompt 最需要规避哪些错误、限制或不希望出现的内容？',
      ],
    };
  }
  if (scenario === 'analysis') {
    return {
      lead: '先把分析对象、决策目标和对比维度补充出来，后面更容易形成知识文档。',
      questions: [
        '你这次最想回答的核心判断题是什么，最终要支持什么决策？',
        '这份分析主要给谁看，他们最关心哪些结论或风险？',
        '你希望重点比较哪些维度，例如市场、用户、方案、竞品或投入产出？',
      ],
    };
  }
  if (scenario === 'learning') {
    return {
      lead: '先确认学习目标和现阶段水平，我会按你的回答逐步补齐重点。',
      questions: [
        '你现在对这个主题的了解程度大概在哪里，最想先补哪一块？',
        '你学习这个主题的最终用途是什么，例如工作应用、项目落地还是系统入门？',
        '你更希望我按什么结构帮助你整理，比如概念地图、步骤清单还是案例拆解？',
      ],
    };
  }
  return {
    lead: '为了更快形成可用的知识文档，建议先补充几条关键背景信息。',
    questions: [
      `你现在最想围绕「${topic}」解决的核心问题是什么？`,
      '这次内容最终要服务谁，他们最关心什么结果或产出？',
      '你当前已经有了哪些信息或约束，还缺哪些关键判断依据？',
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
            '你是产品里的引导问答助手。请根据用户在首页输入的主题，输出 3 个中文引导问题，帮助用户补充生成知识文档所需的关键信息。要求：1. 问题要自然、可直接发送到聊天框。2. 优先识别场景，如 OKR、PRD、Prompt、分析报告、知识学习。3. 不要谈来源分析，不要提论文对比洞察，不要输出解释。4. 只输出 JSON，对象格式为 {"lead":"一句20字内的引导语","questions":["问题1","问题2","问题3"]}。',
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
