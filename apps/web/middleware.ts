import { getToken } from 'next-auth/jwt';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const publicPaths = ['/login', '/register'];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (publicPaths.some((p) => pathname === p || pathname.startsWith(p + '/'))) {
    return NextResponse.next();
  }
  const token = await getToken({
    req: request,
    secret: process.env.NEXTAUTH_SECRET,
  });
  if (!token) {
    const login = new URL('/login', request.url);
    login.searchParams.set('callbackUrl', pathname || '/');
    return NextResponse.redirect(login);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|api/auth).*)'],
};
