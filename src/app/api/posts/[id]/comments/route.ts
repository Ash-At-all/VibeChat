import { NextResponse } from "next/server";
import { z } from "zod";
import { commentDraftSchema } from "@/lib/post-schema";
import { readJsonBody } from "@/lib/server/json-body";
import { enforceRateLimit } from "@/lib/server/rate-limit";
import { getSupabaseServerClient } from "@/lib/supabase/server";

const postIdSchema = z.string().uuid();
const MAX_REQUEST_BYTES = 16 * 1024;
const COMMENT_COLUMNS = "id, post_id, parent_id, author, author_username, body, created_at";
type RouteContext = { params: Promise<{ id: string }> };
type CommentNode = {
  id: string;
  post_id: string;
  parent_id: string | null;
  author: string;
  author_username: string | null;
  body: string;
  created_at: string;
  replies: CommentNode[];
};

async function parsePostId(context: RouteContext) {
  const { id } = await context.params;
  return postIdSchema.safeParse(id);
}

export async function GET(_request: Request, context: RouteContext) {
  const id = await parsePostId(context);
  if (!id.success) return NextResponse.json({ error: "Invalid post ID." }, { status: 400 });

  try {
    const supabase = await getSupabaseServerClient();
    const { data: rows, error } = await supabase
      .from("post_comments_public")
      .select(COMMENT_COLUMNS)
      .eq("post_id", id.data)
      .order("created_at", { ascending: true })
      .limit(500);
    if (error) {
      console.error("Supabase comment list failed:", error.message);
      return NextResponse.json({ error: "Could not load comments. Please try again." }, { status: 502 });
    }

    const comments: CommentNode[] = (rows ?? []).map((row) => ({
      ...row,
      replies: [],
    }));
    const byId = new Map(comments.map((comment) => [comment.id, comment]));
    const roots: typeof comments = [];
    for (const comment of comments) {
      const parent = comment.parent_id ? byId.get(comment.parent_id) : undefined;
      if (parent && parent.id !== comment.id) parent.replies.push(comment);
      else roots.push(comment);
    }
    return NextResponse.json({ comments: roots });
  } catch (error) {
    console.error("Comment list is unavailable:", error);
    return NextResponse.json({ error: "Could not load comments. Check Supabase configuration and try again." }, { status: 503 });
  }
}

export async function POST(request: Request, context: RouteContext) {
  const rateLimitResponse = enforceRateLimit(request, "comments");
  if (rateLimitResponse) return rateLimitResponse;

  const id = await parsePostId(context);
  if (!id.success) return NextResponse.json({ error: "Invalid post ID." }, { status: 400 });

  const payload = await readJsonBody(request, MAX_REQUEST_BYTES);
  if (!payload.ok) return NextResponse.json({ error: payload.error }, { status: payload.status });
  const schema = z.object({
    body: commentDraftSchema.shape.body,
    parentId: z.string().uuid().nullable().optional(),
  }).strict();
  const parsed = schema.safeParse(payload.value);
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
      return NextResponse.json({ error: "Sign in to comment." }, { status: 401 });
    }

    const { data: post, error: postError } = await supabase
      .from("posts")
      .select("id")
      .eq("id", id.data)
      .maybeSingle();
    if (postError) {
      console.error("Supabase comment post lookup failed:", postError.message);
      return NextResponse.json({ error: "Could not verify the post. Please try again." }, { status: 502 });
    }
    if (!post) return NextResponse.json({ error: "The post no longer exists." }, { status: 404 });

    if (parsed.data.parentId) {
      const { data: parent, error: parentError } = await supabase
        .from("post_comments")
        .select("id")
        .eq("id", parsed.data.parentId)
        .eq("post_id", id.data)
        .maybeSingle();
      if (parentError) {
        console.error("Supabase comment parent lookup failed:", parentError.message);
        return NextResponse.json({ error: "Could not reply to this comment. Please try again." }, { status: 502 });
      }
      if (!parent) return NextResponse.json({ error: "The comment you are replying to was not found." }, { status: 404 });
    }

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("username, display_name")
      .eq("id", userResult.user.id)
      .maybeSingle();
    if (profileError) {
      console.error("Supabase comment author lookup failed:", profileError.message);
      return NextResponse.json({ error: "Could not verify your profile. Please try again." }, { status: 502 });
    }

    const { data: row, error } = await supabase
      .from("post_comments")
      .insert({
        post_id: id.data,
        parent_id: parsed.data.parentId ?? null,
        author_id: userResult.user.id,
        body: parsed.data.body,
      })
      .select("id, created_at")
      .single();
    if (error) {
      console.error("Supabase comment create failed:", error.message);
      return NextResponse.json({ error: "Could not publish your comment. Please try again." }, { status: 502 });
    }

    return NextResponse.json({
      comment: {
        id: row.id,
        post_id: id.data,
        parent_id: parsed.data.parentId ?? null,
        author: profile?.display_name || profile?.username || "Community member",
        author_username: profile?.username ?? null,
        body: parsed.data.body,
        created_at: row.created_at,
        replies: [],
      },
    }, { status: 201 });
  } catch (error) {
    console.error("Comment submission is unavailable:", error);
    return NextResponse.json({ error: "Could not publish your comment. Check Supabase configuration and try again." }, { status: 503 });
  }
}
