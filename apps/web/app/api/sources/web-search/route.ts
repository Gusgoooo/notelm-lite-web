import { NextResponse } from 'next/server';
import { getNotebookAccess } from '@/lib/notebook-access';
import { getAdaptiveWebSourceCount, ingestWebSources, searchWebViaOpenRouter } from '@/lib/web-research';

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const notebookId = typeof body?.notebookId === 'string' ? body.notebookId.trim() : '';
    const topic = typeof body?.topic === 'string' ? body.topic.trim() : '';
    const limitRaw = Number.parseInt(String(body?.limit ?? ''), 10);
    const limit = getAdaptiveWebSourceCount(topic, Number.isFinite(limitRaw) ? limitRaw : undefined);

    if (!notebookId) {
      return NextResponse.json({ error: 'notebookId is required' }, { status: 400 });
    }
    if (!topic) {
      return NextResponse.json({ error: 'topic is required' }, { status: 400 });
    }

    const access = await getNotebookAccess(notebookId);
    if (!access.notebook) {
      return NextResponse.json({ error: 'Notebook not found' }, { status: 404 });
    }
    if (!access.canEditSources) {
      return NextResponse.json(
        { error: '该 notebook 来源为只读，请先保存为我的 notebook' },
        { status: 403 }
      );
    }

    const fetched = await searchWebViaOpenRouter({ topic, limit });
    if (fetched.length === 0) {
      return NextResponse.json({ error: '联网检索未返回可用来源，请更换话题重试' }, { status: 409 });
    }

    const result = await ingestWebSources({
      notebookId,
      topic,
      fetched,
      limit,
    });

    return NextResponse.json({
      added: result.added,
      skipped: result.skipped,
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '联网检索失败' },
      { status: 500 }
    );
  }
}
