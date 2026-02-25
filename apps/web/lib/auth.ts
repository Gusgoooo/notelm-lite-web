import type { NextAuthOptions } from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import { db, users, eq } from 'db';
import bcrypt from 'bcryptjs';

declare module 'next-auth' {
  interface User {
    id: string;
    email?: string | null;
    name?: string | null;
  }
  interface Session {
    user: User & { id: string };
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    id?: string;
  }
}

export const authOptions: NextAuthOptions = {
  providers: [
    Credentials({
      name: 'credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;
        const [user] = await db
          .select()
          .from(users)
          .where(eq(users.email, credentials.email.trim().toLowerCase()));
        if (!user) return null;
        const ok = await bcrypt.compare(credentials.password, user.passwordHash);
        if (!ok) return null;
        return {
          id: user.id,
          email: user.email,
          name: user.name ?? undefined,
        };
      },
    }),
  ],
  session: { strategy: 'jwt', maxAge: 30 * 24 * 60 * 60 },
  callbacks: {
    jwt({ token, user }) {
      if (user) token.id = user.id;
      return token;
    },
    session({ session, token }) {
      if (session.user) {
        session.user.id = token.id ?? '';
      }
      return session;
    },
  },
  pages: {
    signIn: '/login',
  },
};
