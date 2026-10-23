import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";

function safeNextPath(value: string | null) {
  if (!value?.startsWith("/") || value.startsWith("//") || value.includes("\\")) return "/";
  const target = new URL(value, "https://vibechat.invalid");
  return target.origin === "https://vibechat.invalid"
    ? `${target.pathname}${target.search}${target.hash}`
    : "/";
}

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const nextPath = safeNextPath(request.nextUrl.searchParams.get("next"));
  const oauthError = request.nextUrl.searchParams.get("error");

  if (oauthError) {
    return NextResponse.redirect(new URL("/?auth_error=oauth_callback_failed", request.url));
  }
  if (!code) {
    return NextResponse.redirect(new URL("/?auth_error=missing_code", request.url));
  }

  try {
    const supabase = await getSupabaseServerClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      console.error("Supabase OAuth callback failed:", error.message);
      return NextResponse.redirect(new URL("/?auth_error=oauth_callback_failed", request.url));
    }
    return NextResponse.redirect(new URL(nextPath, request.url));
  } catch (error) {
    console.error("Supabase OAuth callback could not complete:", error);
    return NextResponse.redirect(new URL("/?auth_error=oauth_callback_failed", request.url));
  }
}
