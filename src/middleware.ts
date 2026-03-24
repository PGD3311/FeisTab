import { type NextRequest } from 'next/server'
import { createMiddlewareClient } from '@/lib/supabase/server'

// STRICT MODE: Middleware redirects unauthenticated users to login.
// Old auth (EventGate, localStorage sessions, access codes) has been removed.
const STRICT_MODE = true

const PUBLIC_ROUTES = ['/auth', '/results', '/public']

function isPublicRoute(pathname: string): boolean {
  return PUBLIC_ROUTES.some((route) => pathname.startsWith(route))
}

export async function middleware(request: NextRequest) {
  const { client, response } = createMiddlewareClient(request)

  // Always refresh session if present
  const {
    data: { user },
  } = await client.auth.getUser()

  // In permissive mode, allow all requests through
  if (!STRICT_MODE) return response

  const { pathname } = request.nextUrl
  if (isPublicRoute(pathname)) return response

  // Strict mode: redirect unauthenticated users
  if (!user) {
    const loginUrl = request.nextUrl.clone()
    loginUrl.pathname = '/auth/login'
    if (pathname !== '/') {
      loginUrl.searchParams.set('next', pathname)
    }
    return Response.redirect(loginUrl)
  }

  return response
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
