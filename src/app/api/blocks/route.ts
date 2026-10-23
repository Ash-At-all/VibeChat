import { NextResponse } from "next/server";
import { z } from "zod";
import { readJsonBody } from "@/lib/server/json-body";
import { enforceRateLimit } from "@/lib/server/rate-limit";
import { getSupabaseServerClient } from "@/lib/supabase/server";

const MAX_REQUEST_BYTES = 1024;
const blockSchema = z.object({
  username: z.string().min(2).max(30).regex(/^[a-z0-9_]+$/),
}).strict();

export async function GET() {
  try {
    const supabase = await getSupabaseServerClient();
    const { data: userResult, error: userError } = await supabase.auth.getUser();
    if (userError || !userResult.user) {
      return NextResponse.json({ error: "Sign in to view blocked accounts." }, { status: 401 });
    }
    const { data: blocks, error } = await supabase
      .from("user_blocks")
      .select("blocked_id")
      .eq("blocker_id", userResult.user.id);
    if (error) {
      console.error("Supabase block list failed:", error.message);
      return NextResponse.json({ error: "Could not load blocked accounts. Please try again." }, { status: 502 });
    }
    const blockedIds = (blocks ?? []).map((block) => block.blocked_id);
    const { data: profiles, error: profilesError } = blockedIds.length
      ? await supabase.from("profiles").select("username, display_name").in("id", blockedIds)
      : { data: [], error: null };
    if (profilesError) {
      console.error("Supabase blocked profile lookup failed:", profilesError.message);
      return NextResponse.json({ error: "Could not load blocked accounts. Please try again." }, { status: 502 });
    }
    return NextResponse.json({
      blocked: (profiles ?? []).map((profile) => ({
        username: profile.username,
        name: profile.display_name || profile.username,
      })),
    });
  } catch (error) {
    console.error("Block list is unavailable:", error);
    return NextResponse.json({ error: "Could not load blocked accounts. Check Supabase configuration and try again." }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const rateLimitResponse = enforceRateLimit(request, "blocks");
  if (rateLimitResponse) return rateLimitResponse;
  const payload = await readJsonBody(request, MAX_REQUEST_BYTES);
  if (!payload.ok) return NextResponse.json({ error: payload.error }, { status: payload.status });
  const parsed = blockSchema.safeParse(payload.value);
  if (!parsed.success) return NextResponse.json({ error: "Choose a valid username to block." }, { status: 400 });

  try {
    const supabase = await getSupabaseServerClient();
    const { data: userResult, error: userError } = await supabase.auth.getUser();
    if (userError || !userResult.user) {
      return NextResponse.json({ error: "Sign in to block an account." }, { status: 401 });
    }
    const { data: target, error: targetError } = await supabase
      .from("profiles")
      .select("id, username, display_name")
      .eq("username", parsed.data.username)
      .maybeSingle();
    if (targetError) {
      console.error("Supabase block target lookup failed:", targetError.message);
      return NextResponse.json({ error: "Could not find that account. Please try again." }, { status: 502 });
    }
    if (!target) return NextResponse.json({ error: "That account was not found." }, { status: 404 });
    if (target.id === userResult.user.id) {
      return NextResponse.json({ error: "You cannot block your own account." }, { status: 400 });
    }
    const { error } = await supabase.from("user_blocks").upsert({
      blocker_id: userResult.user.id,
      blocked_id: target.id,
    }, { onConflict: "blocker_id,blocked_id", ignoreDuplicates: true });
    if (error) {
      console.error("Supabase block create failed:", error.message);
      return NextResponse.json({ error: "Could not block that account. Please try again." }, { status: 502 });
    }
    return NextResponse.json({
      blocked: { username: target.username, name: target.display_name || target.username },
    }, { status: 201 });
  } catch (error) {
    console.error("Block request is unavailable:", error);
    return NextResponse.json({ error: "Could not block that account. Check Supabase configuration and try again." }, { status: 503 });
  }
}

export async function DELETE(request: Request) {
  const rateLimitResponse = enforceRateLimit(request, "blocks");
  if (rateLimitResponse) return rateLimitResponse;
  const payload = await readJsonBody(request, MAX_REQUEST_BYTES);
  if (!payload.ok) return NextResponse.json({ error: payload.error }, { status: payload.status });
  const parsed = blockSchema.safeParse(payload.value);
  if (!parsed.success) return NextResponse.json({ error: "Choose a valid username to unblock." }, { status: 400 });

  try {
    const supabase = await getSupabaseServerClient();
    const { data: userResult, error: userError } = await supabase.auth.getUser();
    if (userError || !userResult.user) {
      return NextResponse.json({ error: "Sign in to unblock an account." }, { status: 401 });
    }
    const { data: target, error: targetError } = await supabase
      .from("profiles")
      .select("id")
      .eq("username", parsed.data.username)
      .maybeSingle();
    if (targetError) {
      console.error("Supabase unblock target lookup failed:", targetError.message);
      return NextResponse.json({ error: "Could not find that account. Please try again." }, { status: 502 });
    }
    if (!target) return NextResponse.json({ error: "That account was not found." }, { status: 404 });
    const { error } = await supabase
      .from("user_blocks")
      .delete()
      .eq("blocker_id", userResult.user.id)
      .eq("blocked_id", target.id);
    if (error) {
      console.error("Supabase block removal failed:", error.message);
      return NextResponse.json({ error: "Could not unblock that account. Please try again." }, { status: 502 });
    }
    return NextResponse.json({ unblocked: parsed.data.username });
  } catch (error) {
    console.error("Unblock request is unavailable:", error);
    return NextResponse.json({ error: "Could not unblock that account. Check Supabase configuration and try again." }, { status: 503 });
  }
}
