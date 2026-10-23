import { NextResponse } from "next/server";
import { z } from "zod";
import { readJsonBody } from "@/lib/server/json-body";
import { enforceRateLimit } from "@/lib/server/rate-limit";
import { getSupabaseServerClient } from "@/lib/supabase/server";

const MAX_REQUEST_BYTES = 4 * 1024;
const reportSchema = z.object({
  type: z.enum(["post", "comment"]),
  targetId: z.string().uuid(),
  reason: z.enum(["harassment", "hate", "spam", "personal-information", "violence", "other"]),
  details: z.string().trim().max(500).default(""),
}).strict();
const reportStatusSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(["reviewed", "actioned"]),
}).strict();

export async function GET() {
  try {
    const supabase = await getSupabaseServerClient();
    const { data: userResult, error: userError } = await supabase.auth.getUser();
    if (userError || !userResult.user) {
      return NextResponse.json({ error: "Sign in to view your reports." }, { status: 401 });
    }
    const isModerator = ["moderator", "admin"].includes(String(userResult.user.app_metadata?.role ?? ""));
    const { data, error } = await supabase
      .from("reports")
      .select("id, post_id, comment_id, reason, details, status, created_at")
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) {
      console.error("Supabase report list failed:", error.message);
      return NextResponse.json({ error: "Could not load your reports. Please try again." }, { status: 502 });
    }
    const rows = data ?? [];
    const postIds = rows.map((report) => report.post_id).filter((id): id is string => id !== null);
    const commentIds = rows.map((report) => report.comment_id).filter((id): id is string => id !== null);
    const [posts, comments] = await Promise.all([
      postIds.length
        ? supabase.from("posts_public").select("id, title, body").in("id", postIds)
        : Promise.resolve({ data: [], error: null }),
      commentIds.length
        ? supabase.from("post_comments_public").select("id, body").in("id", commentIds)
        : Promise.resolve({ data: [], error: null }),
    ]);
    if (posts.error || comments.error) {
      console.error("Supabase report content lookup failed:", posts.error?.message ?? comments.error?.message);
      return NextResponse.json({ error: "Could not load reported content. Please try again." }, { status: 502 });
    }
    const postContent = new Map((posts.data ?? []).map((post) => [post.id, `${post.title}\n${post.body}`]));
    const commentContent = new Map((comments.data ?? []).map((comment) => [comment.id, comment.body]));
    return NextResponse.json({
      isModerator,
      reports: rows.map((report) => ({
        id: report.id,
        type: report.post_id ? "post" : "comment",
        targetId: report.post_id ?? report.comment_id,
        targetContent: report.post_id
          ? postContent.get(report.post_id) ?? "[Content deleted]"
          : commentContent.get(report.comment_id ?? "") ?? "[Content deleted]",
        reason: report.reason,
        details: report.details,
        status: report.status,
        createdAt: report.created_at,
      })),
    });
  } catch (error) {
    console.error("Report list is unavailable:", error);
    return NextResponse.json({ error: "Could not load reports. Check Supabase configuration and try again." }, { status: 503 });
  }
}

export async function PATCH(request: Request) {
  const rateLimitResponse = enforceRateLimit(request, "reports");
  if (rateLimitResponse) return rateLimitResponse;
  const payload = await readJsonBody(request, MAX_REQUEST_BYTES);
  if (!payload.ok) return NextResponse.json({ error: payload.error }, { status: payload.status });
  const parsed = reportStatusSchema.safeParse(payload.value);
  if (!parsed.success) return NextResponse.json({ error: "Choose a valid report and moderation status." }, { status: 400 });

  try {
    const supabase = await getSupabaseServerClient();
    const { data: userResult, error: userError } = await supabase.auth.getUser();
    if (userError || !userResult.user) {
      return NextResponse.json({ error: "Sign in to moderate reports." }, { status: 401 });
    }
    if (!["moderator", "admin"].includes(String(userResult.user.app_metadata?.role ?? ""))) {
      return NextResponse.json({ error: "Moderator access is required." }, { status: 403 });
    }
    const { data, error } = await supabase
      .from("reports")
      .update({ status: parsed.data.status })
      .eq("id", parsed.data.id)
      .select("id, post_id, comment_id, reason, details, status, created_at")
      .maybeSingle();
    if (error) {
      console.error("Supabase report moderation failed:", error.message);
      return NextResponse.json({ error: "Could not update this report. Please try again." }, { status: 502 });
    }
    if (!data) return NextResponse.json({ error: "Report not found." }, { status: 404 });
    return NextResponse.json({ updated: data.id, status: data.status });
  } catch (error) {
    console.error("Report moderation is unavailable:", error);
    return NextResponse.json({ error: "Could not update this report. Check Supabase configuration and try again." }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const rateLimitResponse = enforceRateLimit(request, "reports");
  if (rateLimitResponse) return rateLimitResponse;

  const payload = await readJsonBody(request, MAX_REQUEST_BYTES);
  if (!payload.ok) return NextResponse.json({ error: payload.error }, { status: payload.status });
  const parsed = reportSchema.safeParse(payload.value);
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
      return NextResponse.json({ error: "Sign in to submit a report." }, { status: 401 });
    }
    const isPost = parsed.data.type === "post";
    const targetQuery = isPost
      ? supabase.from("posts").select("id").eq("id", parsed.data.targetId)
      : supabase.from("post_comments").select("id").eq("id", parsed.data.targetId);
    const { data: target, error: targetError } = await targetQuery.maybeSingle();
    if (targetError) {
      console.error("Supabase report target lookup failed:", targetError.message);
      return NextResponse.json({ error: "Could not verify the reported content. Please try again." }, { status: 502 });
    }
    if (!target) return NextResponse.json({ error: "The reported content no longer exists." }, { status: 404 });

    const { data, error } = await supabase
      .from("reports")
      .insert({
        reporter_id: userResult.user.id,
        post_id: isPost ? parsed.data.targetId : null,
        comment_id: isPost ? null : parsed.data.targetId,
        reason: parsed.data.reason,
        details: parsed.data.details,
      })
      .select("id, post_id, comment_id, reason, details, status, created_at")
      .single();
    if (error) {
      console.error("Supabase report create failed:", error.message);
      return NextResponse.json({ error: "Could not submit your report. Please try again." }, { status: 502 });
    }
    return NextResponse.json({
      report: {
        id: data.id,
        type: data.post_id ? "post" : "comment",
        targetId: data.post_id ?? data.comment_id,
        reason: data.reason,
        details: data.details,
        status: data.status,
        createdAt: data.created_at,
      },
    }, { status: 201 });
  } catch (error) {
    console.error("Report submission is unavailable:", error);
    return NextResponse.json({ error: "Could not submit your report. Check Supabase configuration and try again." }, { status: 503 });
  }
}
