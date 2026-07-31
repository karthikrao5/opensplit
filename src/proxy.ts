import { NextResponse, type NextRequest } from 'next/server'
import { auth0 } from '@/lib/auth0'

export async function proxy(request: NextRequest) {
  const authRes = await auth0.middleware(request)

  // Auth0 owns the /auth/* routes (login, callback, logout) and short-circuits
  // them with its own responses — never rewrite those. Match the trailing slash
  // so app routes like /authors aren't mistaken for the Auth0 mount.
  if (request.nextUrl.pathname.startsWith('/auth/')) {
    return authRes
  }

  // If Auth0 produced a redirect or any non-pass-through response, respect it
  // rather than turning it into a plain "next".
  if (authRes.status !== 200 || authRes.headers.has('location')) {
    return authRes
  }

  // Forward the current path to Server Components so requireUser() can build a
  // returnTo for the login redirect. RSC only sees incoming REQUEST headers, so
  // the path must be injected via NextResponse.next({ request: { headers } }).
  const requestHeaders = new Headers(request.headers)
  requestHeaders.set(
    'x-pathname',
    request.nextUrl.pathname + request.nextUrl.search,
  )

  const res = NextResponse.next({ request: { headers: requestHeaders } })

  // Preserve everything Auth0 set on its response — notably the rolling-session
  // Set-Cookie headers, copied losslessly with all their attributes intact.
  // Skip `set-cookie` (re-emitted below via getSetCookie so attributes survive)
  // and any `x-middleware-*` headers, which NextResponse.next wrote onto `res`
  // to carry the x-pathname request override — copying them from authRes would
  // clobber that. (Auth0's non-auth response carries none today; this guards a
  // future SDK change.)
  authRes.headers.forEach((value, key) => {
    const lower = key.toLowerCase()
    if (lower === 'set-cookie' || lower.startsWith('x-middleware-')) return
    res.headers.set(key, value)
  })
  for (const cookie of authRes.headers.getSetCookie()) {
    res.headers.append('set-cookie', cookie)
  }

  return res
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
