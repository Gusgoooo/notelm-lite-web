import { getServerSession } from 'next-auth';
import { db, eq, notebooks } from 'db';
import { authOptions } from '@/lib/auth';

export type NotebookAccess = {
  notebook: (typeof notebooks.$inferSelect) | null;
  userId: string | null;
  isOwner: boolean;
  canView: boolean;
  canEditSources: boolean;
};

export async function getNotebookAccess(notebookId: string): Promise<NotebookAccess> {
  const session = await getServerSession(authOptions);
  const userId = session?.user?.id ?? null;
  const [notebook] = await db.select().from(notebooks).where(eq(notebooks.id, notebookId));

  if (!notebook) {
    return {
      notebook: null,
      userId,
      isOwner: false,
      canView: false,
      canEditSources: false,
    };
  }

  const isOwner = Boolean(userId) && notebook.userId === userId;
  const canView = isOwner || Boolean(notebook.isPublished);

  return {
    notebook,
    userId,
    isOwner,
    canView,
    canEditSources: isOwner,
  };
}
