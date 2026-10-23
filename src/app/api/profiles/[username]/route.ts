import { NextResponse } from "next/server";
import { enforceRateLimit } from "@/lib/server/rate-limit";
import { getSupabaseServerClient } from "@/lib/supabase/server";

const PROFILE_COLUMNS = "id, username, display_name, tag, avatar_url, created_at, updated_at";

export async function GET(
  _request: Request,
  context: { params: Promise<{ username: string }> },
) {
  const rateLimitResponse = enforceRateLimit(_request, "profiles");
  if (rateLimitResponse) return rateLimitResponse;

  const { username } = await context.params;

  try {
    const supabase = await getSupabaseServerClient();
    const { data, error } = await supabase
      .from("profiles")
      .select(PROFILE_COLUMNS)
      .eq("username", username)
      .maybeSingle();

    if (error) {
      console.error("Supabase profile lookup failed:", error.message);
      return NextResponse.json({ error: "Could not load that profile. Please try again." }, { status: 502 });
    }
    if (!data) {
      return NextResponse.json({ error: "Profile not found." }, { status: 404 });
    }
    return NextResponse.json({ profile: data });
  } catch (error) {
    console.error("Profile lookup is unavailable:", error);
    return NextResponse.json({ error: "Supabase is not available. Check server configuration and try again." }, { status: 503 });
  }
}
