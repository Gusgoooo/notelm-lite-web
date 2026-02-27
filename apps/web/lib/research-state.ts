import { randomUUID } from 'crypto';
import { and, conversations, db, desc, eq, messages } from 'db';

const RESEARCH_STATE_PREFIX = '[[RESEARCH_STATE_V1]]';

export type ResearchDirection = {
  id: string;
  title: string;
  researchQuestion: string;
  coreVariables: string;
  researchMethod: string;
  dataSourceAccess: string;
  difficultyStars: number;
  trendHeat: string;
};

export type ResearchStatePhase = 'collecting' | 'analyzing' | 'select_direction' | 'refining' | 'ready';

export type ResearchState = {
  topic: string;
  phase: ResearchStatePhase;
  directions: ResearchDirection[];
  selectedDirectionId?: string;
  starterQuestions?: string[];
  sourceStats?: {
    totalBefore: number;
    totalAfter: number;
  };
  createdAt: string;
  updatedAt: string;
};

function encodeResearchState(state: ResearchState): string {
  return `${RESEARCH_STATE_PREFIX}${JSON.stringify(state)}`;
}

function decodeResearchState(content: string): ResearchState | null {
  if (!content.startsWith(RESEARCH_STATE_PREFIX)) return null;
  const raw = content.slice(RESEARCH_STATE_PREFIX.length);
  try {
    const parsed = JSON.parse(raw) as ResearchState;
    if (!parsed || typeof parsed !== 'object') return null;
    if (typeof parsed.topic !== 'string' || !parsed.topic.trim()) return null;
    if (
      parsed.phase !== 'collecting' &&
      parsed.phase !== 'analyzing' &&
      parsed.phase !== 'select_direction' &&
      parsed.phase !== 'refining' &&
      parsed.phase !== 'ready'
    ) {
      return null;
    }
    if (!Array.isArray(parsed.directions)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function getLatestResearchState(notebookId: string): Promise<{
  state: ResearchState;
  conversationId: string;
  messageId: string;
} | null> {
  const rows = await db
    .select({
      id: messages.id,
      content: messages.content,
      conversationId: messages.conversationId,
      createdAt: messages.createdAt,
    })
    .from(messages)
    .innerJoin(conversations, eq(messages.conversationId, conversations.id))
    .where(and(eq(conversations.notebookId, notebookId), eq(messages.role, 'system')))
    .orderBy(desc(messages.createdAt))
    .limit(30);

  for (const row of rows) {
    const parsed = decodeResearchState(row.content);
    if (!parsed) continue;
    return {
      state: parsed,
      conversationId: row.conversationId,
      messageId: row.id,
    };
  }
  return null;
}

async function ensureConversation(notebookId: string): Promise<string> {
  const [latest] = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(eq(conversations.notebookId, notebookId))
    .orderBy(desc(conversations.createdAt))
    .limit(1);
  if (latest?.id) return latest.id;
  const id = `conv_${randomUUID()}`;
  await db.insert(conversations).values({ id, notebookId, createdAt: new Date() });
  return id;
}

export async function saveResearchState(input: {
  notebookId: string;
  state: ResearchState;
  conversationId?: string;
}): Promise<{ conversationId: string; messageId: string }> {
  const conversationId = input.conversationId ?? (await ensureConversation(input.notebookId));
  const messageId = `msg_${randomUUID()}`;
  await db.insert(messages).values({
    id: messageId,
    conversationId,
    role: 'system',
    content: encodeResearchState(input.state),
    createdAt: new Date(),
  });
  return { conversationId, messageId };
}

export async function addAssistantMessage(input: {
  conversationId: string;
  content: string;
}): Promise<string> {
  const messageId = `msg_${randomUUID()}`;
  await db.insert(messages).values({
    id: messageId,
    conversationId: input.conversationId,
    role: 'assistant',
    content: input.content,
    createdAt: new Date(),
  });
  return messageId;
}

