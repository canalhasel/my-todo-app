import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const AUTH_PAGES = ["/login", "/signup"];

export async function proxy(request: NextRequest) {
  const refreshedCookies: {
    name: string;
    value: string;
    options: CookieOptions;
  }[] = [];
  const refreshedHeaders: Record<string, string> = {};

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookies, headers) => {
          for (const { name, value } of cookies) {
            request.cookies.set(name, value);
          }
          refreshedCookies.push(...cookies);
          Object.assign(refreshedHeaders, headers);
        },
      },
    },
  );

  // getUser revalidates the JWT against the Auth server. getSession would trust
  // a cookie the browser can forge.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  const isAuthPage = AUTH_PAGES.includes(pathname);
  // Route Handlers authenticate themselves and answer with JSON, so redirecting
  // them to an HTML login page would break the fetch caller.
  const isRouteHandler = pathname.startsWith("/api");

  let response: NextResponse;
  if (!user && !isAuthPage && !isRouteHandler) {
    response = NextResponse.redirect(new URL("/login", request.url));
  } else if (user && isAuthPage) {
    response = NextResponse.redirect(new URL("/", request.url));
  } else {
    response = NextResponse.next({ request });
  }

  // Applied last so a refreshed session survives the redirect responses above.
  for (const { name, value, options } of refreshedCookies) {
    response.cookies.set(name, value, options);
  }
  for (const [key, value] of Object.entries(refreshedHeaders)) {
    response.headers.set(key, value);
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
