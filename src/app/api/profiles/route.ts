import { NextResponse } from "next/server";
import { profileSchema } from "@/lib/profile-schema";
import { readJsonBody } from "@/lib/server/json-body";
import { enforceRateLimit } from "@/lib/server/rate-limit";
import { getSupabaseServerClient } from "@/lib/supabase/server";

const PROFILE_COLUMNS = "id, username, display_name, tag, avatar_url, created_at, updated_at";
const MAX_REQUEST_BYTES = 16 * 1024;

export async function GET(request: Request) {
  const rateLimitResponse = enforceRateLimit(request, "profiles");
  if (rateLimitResponse) return rateLimitResponse;

  try {
    const supabase = await getSupabaseServerClient();
    const { data: userResult, error: userError } = await supabase.auth.getUser();
    if (userError || !userResult.user) {
      return NextResponse.json({ error: "Sign in to view your profile." }, { status: 401 });
    }

    const { data, error } = await supabase
      .from("profiles")
      .select(PROFILE_COLUMNS)
      .eq("id", userResult.user.id)
      .maybeSingle();

    if (error) {
      console.error("Supabase profile lookup failed:", error.message);
      return NextResponse.json({ error: "Could not load your profile. Please try again." }, { status: 502 });
    }

    return NextResponse.json({ profile: data ?? null });
  } catch (error) {
    console.error("Profile lookup is unavailable:", error);
    return NextResponse.json({ error: "Supabase is not available. Check server configuration and try again." }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const rateLimitResponse = enforceRateLimit(request, "profiles");
  if (rateLimitResponse) return rateLimitResponse;

  const payload = await readJsonBody(request, MAX_REQUEST_BYTES);
  if (!payload.ok) return NextResponse.json({ error: payload.error }, { status: payload.status });

  const parsed = profileSchema.safeParse(payload.value);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues.map((issue) => issue.message).join(" ") },
      { status: 400 },
    );
  }

  try {
    const supabase = await getSupabaseServerClient();
    const { data: userResult, error: userError } = await supabase.auth.getUser();
    if (userError || !userResult.user) {
      return NextResponse.json({ error: "Sign in to save your profile." }, { status: 401 });
    }

    const { data, error } = await supabase
      .from("profiles")
      .upsert({
        id: userResult.user.id,
        username: parsed.data.username,
        display_name: parsed.data.display_name ?? "",
        tag: parsed.data.tag ?? null,
        avatar_url: parsed.data.avatar_url ?? null,
      })
      .select(PROFILE_COLUMNS)
      .single();

    if (error) {
      console.error("Supabase profile save failed:", error.message);
      if (error.message.toLowerCase().includes("duplicate") || error.message.toLowerCase().includes("unique")) {
        return NextResponse.json({ error: "That username is already taken. Please choose another." }, { status: 409 });
      }
      return NextResponse.json({ error: "Could not save your profile. Please try again." }, { status: 502 });
    }
    return NextResponse.json({ profile: data }, { status: 200 });
  } catch (error) {
    console.error("Profile save is unavailable:", error);
    return NextResponse.json({ error: "Supabase is not available. Check server configuration and try again." }, { status: 503 });
  }
}
