import { getServerSession } from 'next-auth';
import Link from 'next/link';
import { db, eq, notebooks } from 'db';
import { authOptions } from '@/lib/auth';
import { ProjectPanel } from './_components/ProjectPanel';
import { WorkspaceShell } from './_components/WorkspaceShell';

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ notebookId?: string }>;
}) {
  const { notebookId } = await searchParams;

  if (!notebookId) {
    return <ProjectPanel />;
  }

  const session = await getServerSession(authOptions);
  const userId = session?.user?.id ?? null;
  const [notebook] = await db.select().from(notebooks).where(eq(notebooks.id, notebookId));

  if (!notebook) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <div className="rounded-lg border border-gray-200 bg-white p-6 text-center dark:border-gray-800 dark:bg-gray-900">
          <p className="text-sm text-gray-700 dark:text-gray-200">Notebook 不存在或已被删除。</p>
          <Link href="/" className="mt-3 inline-block text-sm text-blue-600 hover:underline dark:text-blue-400">
            返回 Panel
          </Link>
        </div>
      </div>
    );
  }

  const isOwner = Boolean(userId) && notebook.userId === userId;
  const canView = isOwner || Boolean(notebook.isPublished);

  if (!canView) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <div className="rounded-lg border border-gray-200 bg-white p-6 text-center dark:border-gray-800 dark:bg-gray-900">
          <p className="text-sm text-gray-700 dark:text-gray-200">你没有权限访问这个 notebook。</p>
          <Link href="/" className="mt-3 inline-block text-sm text-blue-600 hover:underline dark:text-blue-400">
            返回 Panel
          </Link>
        </div>
      </div>
    );
  }

  return (
    <WorkspaceShell
      notebookId={notebook.id}
      initialTitle={notebook.title}
      initialDescription={notebook.description ?? ''}
      isOwner={isOwner}
      isPublished={Boolean(notebook.isPublished)}
    />
  );
}
