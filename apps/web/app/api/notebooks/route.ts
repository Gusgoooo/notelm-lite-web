import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { db, notebooks, eq, desc, isNull } from 'db';
import { randomUUID } from 'crypto';
import { authOptions } from '@/lib/auth';

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timeout at ${label} after ${ms}ms`));
    }, ms);
    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}

export async function GET() {
  try {
    const session = await withTimeout(getServerSession(authOptions), 4000, 'getServerSession');
    const userId = session?.user?.id ?? null;
    const listQuery = userId
      ? db
          .select()
          .from(notebooks)
          .where(eq(notebooks.userId, userId))
          .orderBy(desc(notebooks.createdAt))
      : db
          .select()
          .from(notebooks)
          .where(isNull(notebooks.userId))
          .orderBy(desc(notebooks.createdAt));
    const list = await withTimeout(listQuery, 4000, 'list notebooks query');
    return NextResponse.json(list, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (e) {
    console.error(e);
    if (e instanceof Error && e.message.startsWith('Timeout at')) {
      return NextResponse.json(
        { error: 'Timeout while loading notebooks', detail: e.message },
        { status: 504 }
      );
    }
    return NextResponse.json(
      { error: 'Failed to list notebooks' },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    const userId = session?.user?.id ?? null;
    const body = await request.json();
    const title =
      typeof body?.title === 'string' && body.title.trim()
        ? body.title.trim()
        : 'Untitled';
    const id = `nb_${randomUUID()}`;
    await db.insert(notebooks).values({
      id,
      userId,
      title,
    });
    const [row] = await db.select().from(notebooks).where(eq(notebooks.id, id));
    return NextResponse.json(row);
  } catch (e: unknown) {
    const cause = e && typeof e === 'object' && 'cause' in e ? (e as { cause?: { message?: string; code?: string } }).cause : null;
    const pgMessage = cause?.message ?? (e instanceof Error ? e.message : '');
    const message = pgMessage || 'Failed to create notebook';
    console.error(e);
    return NextResponse.json(
      { error: 'Failed to create notebook', detail: message },
      { status: 500 }
    );
  }
}
