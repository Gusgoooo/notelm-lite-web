import { Suspense } from 'react';
import Link from 'next/link';
import { ProjectPanel } from './_components/ProjectPanel';
import { SourcesPanel } from './_components/SourcesPanel';
import { ChatPanel } from './_components/ChatPanel';
import { NotesPanel } from './_components/NotesPanel';

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ notebookId?: string }>;
}) {
  const { notebookId } = await searchParams;

  if (!notebookId) {
    return <ProjectPanel />;
  }

  return (
    <div className="flex flex-1 min-h-0 flex-col">
      <div className="h-8 px-3 flex items-center bg-gray-50/50 dark:bg-gray-900/50 border-b border-gray-200 dark:border-gray-800">
        <Link href="/" className="text-xs text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100">
          ← Back to panel
        </Link>
      </div>
      <div className="flex flex-1 min-h-0">
        <aside className="w-80 shrink-0 border-r border-gray-200 dark:border-gray-800 flex flex-col bg-gray-50/50 dark:bg-gray-900/50">
          <SourcesPanel notebookId={notebookId} />
        </aside>
        <main className="flex-1 min-w-0 flex flex-col border-r border-gray-200 dark:border-gray-800">
          <Suspense fallback={null}>
            <ChatPanel notebookId={notebookId} />
          </Suspense>
        </main>
        <aside className="w-80 shrink-0 flex flex-col bg-gray-50/50 dark:bg-gray-900/50">
          <Suspense fallback={null}>
            <NotesPanel notebookId={notebookId} />
          </Suspense>
        </aside>
      </div>
    </div>
  );
}
