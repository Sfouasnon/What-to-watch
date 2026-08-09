import { NextResponse } from "next/server";

import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const requestedNext = url.searchParams.get("next") ?? "/account";
  const next = requestedNext.startsWith("/") && !requestedNext.startsWith("//") ? requestedNext : "/account";
  const supabase = await createSupabaseServerClient();

  if (!supabase) return NextResponse.redirect(new URL("/account?error=not-configured", url.origin));
  if (!code) return NextResponse.redirect(new URL("/account?error=missing-code", url.origin));

  const { error } = await supabase.auth.exchangeCodeForSession(code);
  return NextResponse.redirect(new URL(error ? "/account?error=sign-in" : next, url.origin));
}
