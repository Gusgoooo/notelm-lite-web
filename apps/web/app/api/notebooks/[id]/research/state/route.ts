import { NextResponse } from 'next/server';
import { getNotebookAccess } from '@/lib/notebook-access';
import { getLatestResearchState } from '@/lib/research-state';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const access = await getNotebookAccess(id);
    if (!access.notebook) return NextResponse.json({ error: 'Notebook not found' }, { status: 404 });
    if (!access.canView) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const row = await getLatestResearchState(id);
    return NextResponse.json({
      state: row?.state ?? null,
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'Failed to get research state' }, { status: 500 });
  }
}

