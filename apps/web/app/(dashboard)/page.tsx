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
      <div className="h-10 px-3 flex items-center border-b bg-white/80 backdrop-blur-sm dark:bg-gray-950/70">
        <Link
          href="/"
          className="inline-flex h-7 items-center rounded-md px-2 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-100 hover:text-gray-900 dark:text-gray-300 dark:hover:bg-gray-800 dark:hover:text-gray-100"
        >
          Back to panel
        </Link>
      </div>
      <div className="flex flex-1 min-h-0">
        <aside className="w-80 shrink-0 border-r flex flex-col bg-white/50 dark:bg-gray-950/30">
          <SourcesPanel notebookId={notebookId} />
        </aside>
        <main className="flex-1 min-w-0 flex flex-col border-r bg-white/30 dark:bg-gray-950/20">
          <Suspense fallback={null}>
            <ChatPanel notebookId={notebookId} />
          </Suspense>
        </main>
        <aside className="w-80 shrink-0 flex flex-col bg-white/50 dark:bg-gray-950/30">
          <Suspense fallback={null}>
            <NotesPanel notebookId={notebookId} />
          </Suspense>
        </aside>
      </div>
    </div>
  );
}
