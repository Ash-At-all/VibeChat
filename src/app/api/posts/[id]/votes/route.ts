import { NextResponse } from "next/server";
import { z } from "zod";
import { readJsonBody } from "@/lib/server/json-body";
import { enforceRateLimit } from "@/lib/server/rate-limit";
import { getSupabaseServerClient } from "@/lib/supabase/server";

const postIdSchema = z.string().uuid();
const voteSchema = z.object({ vote: z.union([z.literal(-1), z.literal(0), z.literal(1)]) }).strict();
const MAX_REQUEST_BYTES = 1024;
type RouteContext = { params: Promise<{ id: string }> };

async function parsePostId(context: RouteContext) {
  const { id } = await context.params;
  return postIdSchema.safeParse(id);
}

export async function GET(_request: Request, context: RouteContext) {
  const id = await parsePostId(context);
  if (!id.success) return NextResponse.json({ error: "Invalid post ID." }, { status: 400 });

  try {
    const supabase = await getSupabaseServerClient();
    const { data, error } = await supabase.rpc("get_post_vote_summary", { p_post_id: id.data });
    if (error) {
      console.error("Supabase vote summary failed:", error.message);
      return NextResponse.json({ error: "Could not load votes. Please try again." }, { status: 502 });
    }
    const summary = Array.isArray(data) ? data[0] : data;
    return NextResponse.json({ score: Number(summary?.score ?? 0), vote: Number(summary?.my_vote ?? 0) });
  } catch (error) {
    console.error("Vote summary is unavailable:", error);
    return NextResponse.json({ error: "Could not load votes. Check Supabase configuration and try again." }, { status: 503 });
  }
}

export async function PUT(request: Request, context: RouteContext) {
  const rateLimitResponse = enforceRateLimit(request, "votes");
  if (rateLimitResponse) return rateLimitResponse;

  const id = await parsePostId(context);
  if (!id.success) return NextResponse.json({ error: "Invalid post ID." }, { status: 400 });
  const payload = await readJsonBody(request, MAX_REQUEST_BYTES);
  if (!payload.ok) return NextResponse.json({ error: payload.error }, { status: payload.status });
  const parsed = voteSchema.safeParse(payload.value);
  if (!parsed.success) {
    return NextResponse.json({ error: "Choose an upvote, downvote, or remove your vote." }, { status: 400 });
  }

  try {
    const supabase = await getSupabaseServerClient();
    const { data: userResult, error: userError } = await supabase.auth.getUser();
    if (userError || !userResult.user) {
      return NextResponse.json({ error: "Sign in to vote." }, { status: 401 });
    }
    const { data, error } = await supabase.rpc("set_post_vote", {
      p_post_id: id.data,
      p_vote: parsed.data.vote,
    });
    if (error) {
      console.error("Supabase vote update failed:", error.message);
      return NextResponse.json({ error: "Could not save your vote. Please try again." }, { status: 502 });
    }
    const summary = Array.isArray(data) ? data[0] : data;
    return NextResponse.json({ score: Number(summary?.score ?? 0), vote: Number(summary?.my_vote ?? 0) });
  } catch (error) {
    console.error("Vote update is unavailable:", error);
    return NextResponse.json({ error: "Could not save your vote. Check Supabase configuration and try again." }, { status: 503 });
  }
}
