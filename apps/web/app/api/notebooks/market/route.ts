import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { db, desc, eq, notebooks, users } from 'db';
import { authOptions } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    const userId = session?.user?.id ?? null;

    const list = await db
      .select({
        id: notebooks.id,
        title: notebooks.title,
        description: notebooks.description,
        createdAt: notebooks.createdAt,
        publishedAt: notebooks.publishedAt,
        userId: notebooks.userId,
        ownerName: users.name,
        ownerEmail: users.email,
      })
      .from(notebooks)
      .leftJoin(users, eq(notebooks.userId, users.id))
      .where(eq(notebooks.isPublished, true))
      .orderBy(desc(notebooks.publishedAt), desc(notebooks.createdAt));

    const decorated = list.map((row) => ({
      ...row,
      isMine: userId ? row.userId === userId : false,
    }));
    return NextResponse.json(decorated, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: 'Failed to load market notebooks' }, { status: 500 });
  }
}
