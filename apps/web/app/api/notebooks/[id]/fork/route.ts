import { randomUUID } from 'crypto';
import { NextResponse } from 'next/server';
import { conversations, db, eq, inArray, messages, notebooks, sources } from 'db';
import { getNotebookAccess } from '@/lib/notebook-access';

function cloneTitle(title: string): string {
  const trimmed = title.trim();
  if (!trimmed) return 'Untitled';
  return trimmed.endsWith('（副本）') ? trimmed : `${trimmed}（副本）`;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const access = await getNotebookAccess(id);
    if (!access.notebook) {
      return NextResponse.json({ error: 'Notebook not found' }, { status: 404 });
    }
    if (!access.canView) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    if (!access.userId) {
      return NextResponse.json({ error: 'Please login first' }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const requestedTitle = typeof body?.title === 'string' ? body.title.trim() : '';

    const forkNotebookId = `nb_${randomUUID()}`;
    const now = new Date();

    await db.transaction(async (tx) => {
      await tx.insert(notebooks).values({
        id: forkNotebookId,
        userId: access.userId,
        title: requestedTitle || cloneTitle(access.notebook!.title),
        description: access.notebook!.description ?? '',
        isPublished: false,
        publishedAt: null,
        forkedFromNotebookId: access.notebook!.id,
        createdAt: now,
      });

      const originalConversations = await tx
        .select()
        .from(conversations)
        .where(eq(conversations.notebookId, access.notebook!.id));

      if (originalConversations.length > 0) {
        const conversationIdMap = new Map<string, string>();
        const clonedConversations = originalConversations.map((row) => {
          const clonedId = `conv_${randomUUID()}`;
          conversationIdMap.set(row.id, clonedId);
          return {
            id: clonedId,
            notebookId: forkNotebookId,
            createdAt: row.createdAt,
          };
        });
        await tx.insert(conversations).values(clonedConversations);

        const originalMessages = await tx
          .select()
          .from(messages)
          .where(inArray(messages.conversationId, originalConversations.map((row) => row.id)));

        if (originalMessages.length > 0) {
          const clonedMessages = originalMessages
            .map((row) => {
              const clonedConversationId = conversationIdMap.get(row.conversationId);
              if (!clonedConversationId) return null;
              return {
                id: `msg_${randomUUID()}`,
                conversationId: clonedConversationId,
                role: row.role,
                content: row.content,
                citations: row.citations,
                createdAt: row.createdAt,
              };
            })
            .filter((row): row is NonNullable<typeof row> => Boolean(row));
          if (clonedMessages.length > 0) {
            await tx.insert(messages).values(clonedMessages);
          }
        }
      }

      const originalSources = await tx
        .select()
        .from(sources)
        .where(eq(sources.notebookId, access.notebook!.id));

      if (originalSources.length === 0) return;

      const clonedSources = originalSources.map((row) => {
        return {
          id: `src_${randomUUID()}`,
          notebookId: forkNotebookId,
          filename: row.filename,
          fileUrl: row.fileUrl,
          mime: row.mime,
          // Keep fork operation fast: don't duplicate all chunk rows in transaction.
          // Let worker rebuild chunks for the forked notebook from original files.
          status: 'PENDING' as const,
          errorMessage: null,
          createdAt: now,
        };
      });
      await tx.insert(sources).values(clonedSources);
    });

    const [created] = await db.select().from(notebooks).where(eq(notebooks.id, forkNotebookId));
    return NextResponse.json({ notebook: created, forkedFromNotebookId: access.notebook.id });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: 'Failed to save notebook to my panel' }, { status: 500 });
  }
}
