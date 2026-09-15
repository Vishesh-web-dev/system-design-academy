import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE } from '@/lib/auth/cookie';

/**
 * Route protection. Runs on the Edge, so it must not touch the database — it
 * only checks for the presence of the session cookie and redirects anonymous
 * requests to /login. The cookie is validated against the database inside each
 * page/action (Node runtime) via requireLearnerId; an invalid-but-present
 * cookie therefore passes here and is bounced to /login one layer in, which is
 * public, so there is no redirect loop.
 */
export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const isAuthPage = pathname === '/login' || pathname === '/signup';
  const hasSession = Boolean(req.cookies.get(SESSION_COOKIE)?.value);

  if (!hasSession && !isAuthPage) {
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    url.search = '';
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  // Everything except Next internals and static assets.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)'],
};
