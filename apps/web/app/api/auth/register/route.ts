import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { db, users, eq } from 'db';
import { randomUUID } from 'crypto';

const SALT_ROUNDS = 10;

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const email =
      typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
    const password = typeof body?.password === 'string' ? body.password : '';
    const name = typeof body?.name === 'string' ? body.name.trim() : undefined;

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json(
        { error: 'Valid email is required' },
        { status: 400 }
      );
    }
    if (!password || password.length < 6) {
      return NextResponse.json(
        { error: 'Password must be at least 6 characters' },
        { status: 400 }
      );
    }

    const [existing] = await db.select().from(users).where(eq(users.email, email));
    if (existing) {
      return NextResponse.json(
        { error: 'Email already registered' },
        { status: 409 }
      );
    }

    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    const id = `user_${randomUUID()}`;
    await db.insert(users).values({
      id,
      email,
      passwordHash,
      name: name || null,
    });
    return NextResponse.json({ ok: true, userId: id });
  } catch (e) {
    console.error(e);
    return NextResponse.json(
      { error: 'Registration failed' },
      { status: 500 }
    );
  }
}
