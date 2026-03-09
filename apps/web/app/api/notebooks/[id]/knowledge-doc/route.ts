import { NextResponse } from 'next/server';
import { db, eq, notes } from 'db';
import {
  getDefaultKnowledgeDocScenarioState,
  normalizeKnowledgeDocScenarioState,
  resolveKnowledgeDocScenario,
  type KnowledgeDocScenarioState,
} from '@/lib/knowledge-doc-scenarios';
import { getNotebookAccess } from '@/lib/notebook-access';
import {
  KNOWLEDGE_DOC_COLLECTION_NOTE_TITLE,
  KNOWLEDGE_DOC_HISTORY_NOTE_TITLE,
  KNOWLEDGE_DOC_NOTE_TITLE,
  KNOWLEDGE_DOC_SCENARIO_STATE_NOTE_TITLE,
} from '@/lib/knowledge-unit';

type NoteRow = typeof notes.$inferSelect;

type KnowledgeDocHistoryEntry = {
  id: string;
  content: string;
  summary: string;
  savedAt: string;
};

type StoredKnowledgeDoc = {
  docId: string;
  title: string;
  content: string;
  history: KnowledgeDocHistoryEntry[];
  scenarioState: KnowledgeDocScenarioState;
  createdAt: string;
  updatedAt: string;
};

type KnowledgeDocCollection = {
  activeDocId: string | null;
  docs: StoredKnowledgeDoc[];
};

const HISTORY_STORAGE_LIMIT = 30;

function normalizeHistoryEntries(value: unknown): KnowledgeDocHistoryEntry[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (item): item is KnowledgeDocHistoryEntry =>
        Boolean(
          item &&
            typeof item === 'object' &&
            typeof (item as KnowledgeDocHistoryEntry).id === 'string' &&
            typeof (item as KnowledgeDocHistoryEntry).content === 'string' &&
            typeof (item as KnowledgeDocHistoryEntry).summary === 'string' &&
            typeof (item as KnowledgeDocHistoryEntry).savedAt === 'string'
        )
    )
    .slice(0, HISTORY_STORAGE_LIMIT);
}

function parseStoredHistory(raw: string | null | undefined): KnowledgeDocHistoryEntry[] {
  if (!raw) return [];
  try {
    return normalizeHistoryEntries(JSON.parse(raw));
  } catch {
    return [];
  }
}

function parseStoredScenarioState(raw: string | null | undefined): KnowledgeDocScenarioState {
  if (!raw) return getDefaultKnowledgeDocScenarioState();
  try {
    return normalizeKnowledgeDocScenarioState(JSON.parse(raw));
  } catch {
    return getDefaultKnowledgeDocScenarioState();
  }
}

function toIso(value: unknown): string {
  if (typeof value === 'string') {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  }
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString();
  }
  return new Date().toISOString();
}

function stripHtml(value: string): string {
  return value.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function hasMeaningfulContent(value: string): boolean {
  return stripHtml(value).length > 0;
}

function createDocId(): string {
  return `doc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeStoredDoc(value: unknown, fallbackIndex: number): StoredKnowledgeDoc | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Partial<StoredKnowledgeDoc>;
  const docId =
    typeof row.docId === 'string' && row.docId.trim()
      ? row.docId.trim().slice(0, 80)
      : `doc_${fallbackIndex + 1}`;
  const scenarioState = normalizeKnowledgeDocScenarioState(row.scenarioState);
  const fallbackTitle = resolveKnowledgeDocScenario(scenarioState, scenarioState.activeScenarioId).label || '知识文档';
  return {
    docId,
    title:
      typeof row.title === 'string' && row.title.trim()
        ? row.title.trim().slice(0, 60)
        : fallbackTitle,
    content: typeof row.content === 'string' ? row.content : '',
    history: normalizeHistoryEntries(row.history),
    scenarioState,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  };
}

function normalizeCollection(value: unknown): KnowledgeDocCollection {
  if (!value || typeof value !== 'object') {
    return { activeDocId: null, docs: [] };
  }
  const row = value as Partial<KnowledgeDocCollection>;
  const parsedDocs = Array.isArray(row.docs)
    ? row.docs
        .map((item, index) => normalizeStoredDoc(item, index))
        .filter((item): item is StoredKnowledgeDoc => Boolean(item))
    : [];
  const seen = new Set<string>();
  const docs = parsedDocs.filter((item) => {
    if (seen.has(item.docId)) return false;
    seen.add(item.docId);
    return true;
  });
  const activeDocId =
    typeof row.activeDocId === 'string' && docs.some((item) => item.docId === row.activeDocId)
      ? row.activeDocId
      : null;
  return {
    activeDocId,
    docs,
  };
}

function parseStoredCollection(raw: string | null | undefined): KnowledgeDocCollection {
  if (!raw) return { activeDocId: null, docs: [] };
  try {
    return normalizeCollection(JSON.parse(raw));
  } catch {
    return { activeDocId: null, docs: [] };
  }
}

function resolveActiveDoc(collection: KnowledgeDocCollection): StoredKnowledgeDoc | null {
  if (collection.activeDocId) {
    const matched = collection.docs.find((item) => item.docId === collection.activeDocId);
    if (matched) return matched;
  }
  return collection.docs[0] ?? null;
}

function buildLegacyCollection(input: {
  contentRow: NoteRow | null;
  historyRow: NoteRow | null;
  scenarioRow: NoteRow | null;
}): KnowledgeDocCollection {
  if (!input.contentRow && !input.historyRow && !input.scenarioRow) {
    return { activeDocId: null, docs: [] };
  }
  const scenarioState = parseStoredScenarioState(input.scenarioRow?.content);
  return {
    activeDocId: 'legacy',
    docs: [
      {
        docId: 'legacy',
        title: resolveKnowledgeDocScenario(scenarioState, scenarioState.activeScenarioId).label || '知识文档',
        content: input.contentRow?.content ?? '',
        history: parseStoredHistory(input.historyRow?.content),
        scenarioState,
        createdAt: toIso(input.contentRow?.createdAt),
        updatedAt: toIso(input.contentRow?.updatedAt ?? input.historyRow?.updatedAt ?? input.scenarioRow?.updatedAt),
      },
    ],
  };
}

function buildDocSummaries(collection: KnowledgeDocCollection) {
  return [...collection.docs]
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
    .map((item) => ({
      docId: item.docId,
      title: item.title,
      updatedAt: item.updatedAt,
      hasContent: hasMeaningfulContent(item.content),
      scenarioLabel: resolveKnowledgeDocScenario(item.scenarioState, item.scenarioState.activeScenarioId).label,
    }));
}

function buildResponsePayload(collection: KnowledgeDocCollection, requestedDocId?: string | null) {
  const selected =
    (requestedDocId ? collection.docs.find((item) => item.docId === requestedDocId) : null) ??
    resolveActiveDoc(collection);
  return {
    content: selected?.content ?? '',
    id: selected?.docId ?? null,
    docId: selected?.docId ?? null,
    activeDocId: collection.activeDocId ?? selected?.docId ?? null,
    history: selected?.history ?? [],
    scenarioState: selected?.scenarioState ?? getDefaultKnowledgeDocScenarioState(),
    docs: buildDocSummaries(collection),
  };
}

async function upsertSystemNote(input: {
  notebookId: string;
  title: string;
  content: string;
  existing: NoteRow | null;
  now: Date;
}) {
  if (input.existing) {
    await db
      .update(notes)
      .set({ content: input.content, updatedAt: input.now })
      .where(eq(notes.id, input.existing.id));
    return;
  }
  await db.insert(notes).values({
    id: `note_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
    notebookId: input.notebookId,
    title: input.title,
    content: input.content,
    createdAt: input.now,
    updatedAt: input.now,
  });
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: notebookId } = await params;
  try {
    const access = await getNotebookAccess(notebookId);
    if (!access.notebook) {
      return NextResponse.json({ error: 'Notebook not found' }, { status: 404 });
    }
    if (!access.canView) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    const { searchParams } = new URL(request.url);
    const requestedDocId = searchParams.get('docId')?.trim() ?? null;

    const rows = await db.select().from(notes).where(eq(notes.notebookId, notebookId));
    const contentRow = rows.find((row) => row.title === KNOWLEDGE_DOC_NOTE_TITLE) ?? null;
    const historyRow = rows.find((row) => row.title === KNOWLEDGE_DOC_HISTORY_NOTE_TITLE) ?? null;
    const scenarioRow = rows.find((row) => row.title === KNOWLEDGE_DOC_SCENARIO_STATE_NOTE_TITLE) ?? null;
    const collectionRow = rows.find((row) => row.title === KNOWLEDGE_DOC_COLLECTION_NOTE_TITLE) ?? null;

    let collection = parseStoredCollection(collectionRow?.content);
    if (collection.docs.length === 0) {
      collection = buildLegacyCollection({
        contentRow,
        historyRow,
        scenarioRow,
      });
    }
    if (!collection.activeDocId) {
      collection.activeDocId = collection.docs[0]?.docId ?? null;
    }
    return NextResponse.json(buildResponsePayload(collection, requestedDocId));
  } catch (e) {
    console.error(e);
    return NextResponse.json(
      { error: 'Failed to load knowledge document' },
      { status: 500 }
    );
  }
}

export async function PATCH(
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
    const hasContent = typeof body?.content === 'string';
    const hasHistory = body?.history !== undefined;
    const hasScenarioState = body?.scenarioState !== undefined;
    const content = hasContent ? body.content : '';
    const history = hasHistory ? normalizeHistoryEntries(body?.history) : [];
    const scenarioState = hasScenarioState
      ? normalizeKnowledgeDocScenarioState(body?.scenarioState)
      : getDefaultKnowledgeDocScenarioState();
    const createDoc = body?.createDoc === true;
    const docTitle =
      typeof body?.docTitle === 'string' && body.docTitle.trim()
        ? body.docTitle.trim().slice(0, 60)
        : '';
    const requestedDocId =
      typeof body?.docId === 'string' && body.docId.trim()
        ? body.docId.trim().slice(0, 80)
        : null;
    const requestedActiveDocId =
      typeof body?.activeDocId === 'string' && body.activeDocId.trim()
        ? body.activeDocId.trim().slice(0, 80)
        : null;

    const rows = await db.select().from(notes).where(eq(notes.notebookId, notebookId));
    const contentRow = rows.find((row) => row.title === KNOWLEDGE_DOC_NOTE_TITLE) ?? null;
    const historyRow = rows.find((row) => row.title === KNOWLEDGE_DOC_HISTORY_NOTE_TITLE) ?? null;
    const scenarioRow = rows.find((row) => row.title === KNOWLEDGE_DOC_SCENARIO_STATE_NOTE_TITLE) ?? null;
    const collectionRow = rows.find((row) => row.title === KNOWLEDGE_DOC_COLLECTION_NOTE_TITLE) ?? null;

    let collection = parseStoredCollection(collectionRow?.content);
    if (collection.docs.length === 0) {
      collection = buildLegacyCollection({
        contentRow,
        historyRow,
        scenarioRow,
      });
    }

    const now = new Date();
    const nowIso = now.toISOString();

    if (createDoc) {
      const nextDocId = createDocId();
      const nextScenarioState = hasScenarioState ? scenarioState : getDefaultKnowledgeDocScenarioState();
      collection.docs.unshift({
        docId: nextDocId,
        title:
          docTitle ||
          resolveKnowledgeDocScenario(nextScenarioState, nextScenarioState.activeScenarioId).label ||
          `知识文档 ${collection.docs.length + 1}`,
        content: hasContent ? content : '',
        history: hasHistory ? history : [],
        scenarioState: nextScenarioState,
        createdAt: nowIso,
        updatedAt: nowIso,
      });
      collection.activeDocId = nextDocId;
    }

    if (requestedActiveDocId && collection.docs.some((item) => item.docId === requestedActiveDocId)) {
      collection.activeDocId = requestedActiveDocId;
    }

    const targetDocId = requestedDocId || collection.activeDocId || null;
    if (targetDocId && (hasContent || hasHistory || hasScenarioState || docTitle)) {
      let target = collection.docs.find((item) => item.docId === targetDocId) ?? null;
      if (!target) {
        target = {
          docId: targetDocId,
          title: docTitle || `知识文档 ${collection.docs.length + 1}`,
          content: '',
          history: [],
          scenarioState: getDefaultKnowledgeDocScenarioState(),
          createdAt: nowIso,
          updatedAt: nowIso,
        };
        collection.docs.unshift(target);
      }
      if (docTitle) target.title = docTitle;
      if (hasContent) target.content = content;
      if (hasHistory) target.history = history;
      if (hasScenarioState) target.scenarioState = scenarioState;
      if (!target.title.trim()) {
        target.title =
          resolveKnowledgeDocScenario(target.scenarioState, target.scenarioState.activeScenarioId).label || '知识文档';
      }
      target.updatedAt = nowIso;
      collection.activeDocId = target.docId;
    }

    if (!collection.activeDocId || !collection.docs.some((item) => item.docId === collection.activeDocId)) {
      collection.activeDocId = collection.docs[0]?.docId ?? null;
    }

    await upsertSystemNote({
      notebookId,
      title: KNOWLEDGE_DOC_COLLECTION_NOTE_TITLE,
      content: JSON.stringify(collection),
      existing: collectionRow,
      now,
    });

    const activeDoc = resolveActiveDoc(collection);
    if (activeDoc) {
      await upsertSystemNote({
        notebookId,
        title: KNOWLEDGE_DOC_NOTE_TITLE,
        content: activeDoc.content,
        existing: contentRow,
        now,
      });
      await upsertSystemNote({
        notebookId,
        title: KNOWLEDGE_DOC_HISTORY_NOTE_TITLE,
        content: JSON.stringify(activeDoc.history),
        existing: historyRow,
        now,
      });
      await upsertSystemNote({
        notebookId,
        title: KNOWLEDGE_DOC_SCENARIO_STATE_NOTE_TITLE,
        content: JSON.stringify(activeDoc.scenarioState),
        existing: scenarioRow,
        now,
      });
    }

    return NextResponse.json(buildResponsePayload(collection));
  } catch (e) {
    console.error(e);
    return NextResponse.json(
      { error: 'Failed to save knowledge document' },
      { status: 500 }
    );
  }
}
