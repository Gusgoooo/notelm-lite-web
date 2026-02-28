import { NextResponse } from 'next/server';
import { db, eq, notes } from 'db';
import { getNotebookAccess } from '@/lib/notebook-access';
import {
  KNOWLEDGE_UNIT_NOTE_TITLE,
  applyKnowledgeUnitUpdate,
  createDefaultKnowledgeUnit,
  parseKnowledgeUnit,
  serializeKnowledgeUnit,
  type KnowledgeUnit,
  type KnowledgeUnitDimension,
  type KnowledgeUnitTriggerInput,
} from '@/lib/knowledge-unit';
import { getAgentSettings } from '@/lib/agent-settings';

async function getKuNote(notebookId: string) {
  const list = await db.select().from(notes).where(eq(notes.notebookId, notebookId));
  return list.find((item) => item.title === KNOWLEDGE_UNIT_NOTE_TITLE) ?? null;
}

async function saveKuNote(notebookId: string, ku: KnowledgeUnit, existingId?: string | null) {
  const now = new Date();
  const id = existingId ?? `note_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  if (existingId) {
    await db
      .update(notes)
      .set({
        title: KNOWLEDGE_UNIT_NOTE_TITLE,
        content: serializeKnowledgeUnit(ku),
        updatedAt: now,
      })
      .where(eq(notes.id, existingId));
  } else {
    await db.insert(notes).values({
      id,
      notebookId,
      title: KNOWLEDGE_UNIT_NOTE_TITLE,
      content: serializeKnowledgeUnit(ku),
      createdAt: now,
      updatedAt: now,
    });
  }
  return id;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: notebookId } = await params;
    const access = await getNotebookAccess(notebookId);
    if (!access.notebook) {
      return NextResponse.json({ error: 'Notebook not found' }, { status: 404 });
    }
    if (!access.canView) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    const row = await getKuNote(notebookId);
    const ku = parseKnowledgeUnit(row?.content, notebookId, access.notebook.title);
    const settings = await getAgentSettings();
    return NextResponse.json({ ku, exists: Boolean(row), templates: settings.knowledgeUnitTemplates });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'Failed to load knowledge unit' }, { status: 500 });
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: notebookId } = await params;
    const access = await getNotebookAccess(notebookId);
    if (!access.notebook) {
      return NextResponse.json({ error: 'Notebook not found' }, { status: 404 });
    }
    if (!access.isOwner) {
      return NextResponse.json({ error: 'Only the owner can update knowledge unit' }, { status: 403 });
    }

    const body = (await request.json().catch(() => ({}))) as Partial<KnowledgeUnitTriggerInput>;
    const trigger = body.trigger;
    if (
      trigger !== 'ON_ANSWER_GENERATED' &&
      trigger !== 'ON_NOTE_SAVED' &&
      trigger !== 'ON_SOURCE_ADDED'
    ) {
      return NextResponse.json({ error: 'Invalid trigger' }, { status: 400 });
    }

    const row = await getKuNote(notebookId);
    const current = row
      ? parseKnowledgeUnit(row.content, notebookId, access.notebook.title)
      : createDefaultKnowledgeUnit(notebookId, access.notebook.title);
    const settings = await getAgentSettings();
    const { next, diff } = applyKnowledgeUnitUpdate(current, {
      trigger,
      titleHint: access.notebook.title,
      user_question: typeof body.user_question === 'string' ? body.user_question : undefined,
      assistant_answer: typeof body.assistant_answer === 'string' ? body.assistant_answer : undefined,
      saved_notes: Array.isArray(body.saved_notes) ? body.saved_notes.filter(Boolean) : [],
      citations: Array.isArray(body.citations) ? body.citations.filter(Boolean) : [],
      source_snapshot: Array.isArray(body.source_snapshot) ? body.source_snapshot.filter(Boolean) : [],
    });
    await saveKuNote(notebookId, next, row?.id ?? null);
    return NextResponse.json({ ku: next, diff, templates: settings.knowledgeUnitTemplates });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'Failed to update knowledge unit' }, { status: 500 });
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: notebookId } = await params;
    const access = await getNotebookAccess(notebookId);
    if (!access.notebook) {
      return NextResponse.json({ error: 'Notebook not found' }, { status: 404 });
    }
    if (!access.isOwner) {
      return NextResponse.json({ error: 'Only the owner can edit knowledge unit' }, { status: 403 });
    }

    const body = await request.json().catch(() => ({}));
    const row = await getKuNote(notebookId);
    const ku = parseKnowledgeUnit(row?.content, notebookId, access.notebook.title);

    if (typeof body?.title === 'string' && body.title.trim()) {
      ku.title = body.title.trim().slice(0, 120);
    }
    if (typeof body?.templateId === 'string') {
      ku.template_id = body.templateId.trim() || null;
    }
    if (typeof body?.templateLabel === 'string') {
      ku.template_label = body.templateLabel.trim() || null;
    }
    if (Array.isArray(body?.dimensions)) {
      ku.custom_dimensions = (body.dimensions as KnowledgeUnitDimension[])
        .filter((item) => item && typeof item === 'object')
        .map((item) => ({
          id: typeof item.id === 'string' && item.id ? item.id : `dim_${Date.now()}`,
          name: typeof item.name === 'string' ? item.name.trim().slice(0, 24) : '未命名维度',
          children: Array.isArray(item.children)
            ? item.children
                .filter((child) => child && typeof child === 'object')
                .map((child) => ({
                  id: typeof child.id === 'string' && child.id ? child.id : `sub_${Date.now()}`,
                  name:
                    typeof child.name === 'string' ? child.name.trim().slice(0, 24) : '待补充',
                  items: Array.isArray(child.items)
                    ? child.items
                        .filter((entry) => typeof entry === 'string')
                        .map((entry) => String(entry).trim())
                        .filter(Boolean)
                        .slice(0, 6)
                    : [],
                }))
                .slice(0, 8)
            : [],
        }))
        .slice(0, 8);
    }
    if (typeof body?.assertionId === 'string' && typeof body?.locked === 'boolean') {
      const target = ku.assertions.find((item) => item.assertion_id === body.assertionId);
      if (target) {
        target.locked_by_user = body.locked;
        target.updated_at = new Date().toISOString();
        target.change_log.unshift({
          at: target.updated_at,
          type: body.locked ? 'LOCKED_BY_USER' : 'UNLOCKED_BY_USER',
          reason: body.locked ? '用户锁定了该结论' : '用户解除锁定',
        });
      }
    }
    await saveKuNote(notebookId, ku, row?.id ?? null);
    const settings = await getAgentSettings();
    return NextResponse.json({ ku, templates: settings.knowledgeUnitTemplates });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'Failed to edit knowledge unit' }, { status: 500 });
  }
}
