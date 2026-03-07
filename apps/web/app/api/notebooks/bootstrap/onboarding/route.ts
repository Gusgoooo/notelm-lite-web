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
      lead: '先从你最想推进的部分聊起，我会顺着你的回答继续帮你补全。',
      questions: [
        '如果我要把这份 OKR 写得更扎实，我该先补充哪些项目背景、阶段目标和负责人信息？',
        '为了明确关键结果，我需要先想清楚哪些目标指标、当前基线和预期目标值？',
        '如果我要避免这份 OKR 落空，我还应该先补哪些时间、资源或协作约束？',
      ],
    };
  }
  if (scenario === 'prd') {
    return {
      lead: '先把用户和场景聊具体，我会更容易帮你收敛成能落地的 PRD。',
      questions: [
        '如果我要把这份 PRD 写清楚，我应该先补充哪些核心用户和痛点信息？',
        '为了把方案收敛下来，我还需要先明确哪些关键场景、动作链路和边界？',
        '如果这次方案要顺利推进，我应该先想清楚哪些上线后的验证指标或业务结果？',
      ],
    };
  }
  if (scenario === 'prompt') {
    return {
      lead: '先把任务目标说清楚，我会帮你逐步收敛成可复用的 Prompt。',
      questions: [
        '如果我要写出一条更稳定的 Prompt，我该先补充哪些任务目标和使用场景？',
        '为了让模型输出更符合预期，我还需要先明确哪些输入信息、格式要求或风格约束？',
        '如果我想减少跑偏结果，我应该先补充哪些限制条件、边界或禁区？',
      ],
    };
  }
  if (scenario === 'analysis') {
    return {
      lead: '先点一个你最想追下去的问题，我会继续帮你把分析框架补齐。',
      questions: [
        '如果我要把这次分析做得更有结论，我应该先明确哪一个核心判断题和决策目标？',
        '为了让这份分析更有说服力，我还需要先补充哪些受众、关注点或风险视角？',
        '如果我想继续深挖，这次最值得优先比较哪些维度，比如市场、方案、竞品或投入产出？',
      ],
    };
  }
  if (scenario === 'learning') {
    return {
      lead: '先说你最想学会哪一部分，我会顺着你的兴趣继续拆解。',
      questions: [
        '如果我要更高效地学这个主题，我应该先说明自己现在的基础和最想补的短板吗？',
        '为了让这次学习更有方向，我还需要先明确最终用途，比如工作应用、项目落地还是系统入门？',
        '如果要让我更容易吸收，你建议我先选哪种整理方式，比如概念地图、步骤清单还是案例拆解？',
      ],
    };
  }
  return {
    lead: '先点一个你最想聊的问题，我会顺着它继续帮你把信息补完整。',
    questions: [
      `如果我要继续推进「${topic}」，我现在最值得先问清楚的核心问题是什么？`,
      '为了让后续内容更有方向，我还需要先明确服务对象和他们最关心的结果吗？',
      '如果我要把这件事讲完整，我应该先补哪些已有信息、限制条件或缺失判断依据？',
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
            '你是产品里的引导问答助手。请根据用户在首页输入的主题，输出 3 个中文引导问题，帮助用户补充生成知识文档所需的关键信息。要求：1. 问题要从用户视角出发，像用户会主动点击发送的问题，尽量使用“如果我要…/为了让我…/我还需要先…”这类自然说法。2. 问题要让用户有继续探索和补充信息的兴趣。3. 优先识别场景，如 OKR、PRD、Prompt、分析报告、知识学习。4. 不要谈来源分析，不要提论文对比洞察，不要输出解释。5. 只输出 JSON，对象格式为 {"lead":"一句20字内的引导语","questions":["问题1","问题2","问题3"]}。',
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
