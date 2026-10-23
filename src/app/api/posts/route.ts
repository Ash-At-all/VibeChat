import { NextResponse } from "next/server";
import { citySlugSchema, postCreateRequestSchema } from "@/lib/post-schema";
import { readJsonBody } from "@/lib/server/json-body";
import { enforceRateLimit } from "@/lib/server/rate-limit";
import { getSupabaseServerClient } from "@/lib/supabase/server";

const PUBLIC_POST_COLUMNS = "id, city_slug, tag, title, body, image_paths, created_at, updated_at";
const AUTHENTICATED_POST_COLUMNS = `${PUBLIC_POST_COLUMNS}, author_id`;
const MAX_REQUEST_BYTES = 16 * 1024;
type CommentNode = {
  id: string;
  parent_id: string | null;
  author: string;
  author_username: string | null;
  body: string;
  replies: CommentNode[];
};
type VoteSummary = { post_id: string; score: number; my_vote: number };

async function addPostInteractions(
  supabase: Awaited<ReturnType<typeof getSupabaseServerClient>>,
  posts: Array<{ id: string; [key: string]: unknown }>,
) {
  if (posts.length === 0) return [];
  const postIds = posts.map((post) => post.id);
  const [commentsResult, votesResult] = await Promise.all([
    supabase
      .from("post_comments_public")
      .select("id, post_id, parent_id, author, author_username, body, created_at")
      .in("post_id", postIds)
      .order("created_at", { ascending: true })
      .limit(5000),
    supabase.rpc("get_post_vote_summaries", { p_post_ids: postIds }),
  ]);

  if (commentsResult.error) throw new Error(`Comment list failed: ${commentsResult.error.message}`);
  if (votesResult.error) throw new Error(`Vote summary failed: ${votesResult.error.message}`);

  const commentRows = commentsResult.data ?? [];
  const postAuthorIds = [...new Set(posts
    .map((post) => post.author_id)
    .filter((authorId): authorId is string => typeof authorId === "string"))];
  const { data: profiles, error: profilesError } = postAuthorIds.length
    ? await supabase.from("profiles").select("id, username, display_name, avatar_url").in("id", postAuthorIds)
    : { data: [], error: null };
  if (profilesError) throw new Error(`Post author lookup failed: ${profilesError.message}`);

  const profileById = new Map((profiles ?? []).map((profile) => [profile.id, profile]));
  const commentsByPost = new Map<string, CommentNode[]>();
  const commentsById = new Map<string, CommentNode>();
  for (const comment of commentRows) {
    const node: CommentNode = {
      id: comment.id,
      parent_id: comment.parent_id,
      author: comment.author,
      author_username: comment.author_username,
      body: comment.body,
      replies: [],
    };
    commentsById.set(node.id, node);
    const items = commentsByPost.get(comment.post_id) ?? [];
    items.push(node);
    commentsByPost.set(comment.post_id, items);
  }

  const voteByPost = new Map<string, VoteSummary>(
    (votesResult.data ?? []).map((vote: VoteSummary) => [vote.post_id, vote]),
  );
  return posts.map((post) => {
    const comments = commentsByPost.get(post.id) ?? [];
    const roots: CommentNode[] = [];
    for (const comment of comments) {
      const parent = comment.parent_id ? commentsById.get(comment.parent_id) : undefined;
      if (parent) parent.replies.push(comment);
      else roots.push(comment);
    }
    const vote = voteByPost.get(post.id);
    const profile = typeof post.author_id === "string" ? profileById.get(post.author_id) : undefined;
    return {
      ...post,
      author: profile?.display_name || profile?.username || post.author || "Community member",
      author_username: profile?.username ?? post.author_username ?? null,
      avatar_url: profile?.avatar_url ?? post.avatar_url ?? null,
      comments: roots,
      votes: Number(vote?.score ?? 0),
      user_vote: Number(vote?.my_vote ?? 0),
    };
  });
}

function isMissingImagePathsColumn(message: string) {
  return message.toLowerCase().includes("image_paths")
    && (message.toLowerCase().includes("schema cache") || message.toLowerCase().includes("does not exist"));
}

export async function GET(request: Request) {
  const city = new URL(request.url).searchParams.get("city");
  const author = new URL(request.url).searchParams.get("author");
  if (city) {
    const parsedCity = citySlugSchema.safeParse(city);
    if (!parsedCity.success) {
      return NextResponse.json({ error: "Choose a valid city." }, { status: 400 });
    }
  }

  try {
    const supabase = await getSupabaseServerClient();
    const { data: sessionResult, error: sessionError } = await supabase.auth.getSession();
    if (sessionError) {
      return NextResponse.json({ error: "Could not verify your session. Please refresh and try again." }, { status: 401 });
    }

    let authorId: string | undefined;
    if (sessionResult.session) {
      const { data: userResult, error: userError } = await supabase.auth.getUser();
      if (userError || !userResult.user) {
        return NextResponse.json({ error: "Your session has expired. Please sign in again." }, { status: 401 });
      }
      authorId = userResult.user.id;
    }

    if (authorId) {
      let query = supabase
        .from("posts")
        .select(AUTHENTICATED_POST_COLUMNS)
        .order("created_at", { ascending: false });
      if (city) query = query.eq("city_slug", city);
      if (author) query = query.eq("author_id", author);
      const { data, error } = await query;
      if (error) {
        console.error("Supabase post list failed:", error.message);
        if (isMissingImagePathsColumn(error.message)) {
          return NextResponse.json(
            { error: "The post image database migration is missing. Run the image_paths SQL migration in Supabase SQL Editor, then retry." },
            { status: 503 },
          );
        }
        return NextResponse.json({ error: "Could not load posts from Supabase. Please try again." }, { status: 502 });
      }
      return NextResponse.json({
        posts: await addPostInteractions(
          supabase,
          (data ?? []).map((post) => ({ ...post, mine: post.author_id === authorId })),
        ),
      });
    }

    let query = supabase
      .from("posts_public")
      .select(`${PUBLIC_POST_COLUMNS}, author, author_username, avatar_url`)
      .order("created_at", { ascending: false });
    if (city) query = query.eq("city_slug", city);
    if (author) query = query.eq("author_username", author);
    const { data, error } = await query;
    if (error) {
      console.error("Supabase post list failed:", error.message);
      if (isMissingImagePathsColumn(error.message)) {
        return NextResponse.json(
          { error: "The post image database migration is missing. Run the image_paths SQL migration in Supabase SQL Editor, then retry." },
          { status: 503 },
        );
      }
      return NextResponse.json({ error: "Could not load posts from Supabase. Please try again." }, { status: 502 });
    }
    return NextResponse.json({ posts: await addPostInteractions(supabase, data ?? []) });
  } catch (error) {
    console.error("Supabase post list is unavailable:", error);
    return NextResponse.json({ error: "Supabase is not available. Check server configuration and try again." }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const rateLimitResponse = enforceRateLimit(request, "posts");
  if (rateLimitResponse) return rateLimitResponse;

  const payload = await readJsonBody(request, MAX_REQUEST_BYTES);
  if (!payload.ok) return NextResponse.json({ error: payload.error }, { status: payload.status });

  const parsed = postCreateRequestSchema.safeParse(payload.value);
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
      return NextResponse.json({ error: "Sign in with Google before publishing a post." }, { status: 401 });
    }
    if (parsed.data.imagePaths.some((path) => !path.startsWith(`${userResult.user.id}/`))) {
      return NextResponse.json({ error: "You can only attach images you uploaded." }, { status: 403 });
    }

    const { data, error } = await supabase
      .from("posts")
      .insert({
        city_slug: parsed.data.post.city,
        tag: parsed.data.post.tag,
        title: parsed.data.post.title,
        body: parsed.data.post.body,
        image_paths: parsed.data.imagePaths,
      })
      .select(AUTHENTICATED_POST_COLUMNS)
      .single();

    if (error) {
      console.error("Supabase post create failed:", error.message);
      if (isMissingImagePathsColumn(error.message)) {
        return NextResponse.json(
          { error: "The post image database migration is missing. Run the image_paths SQL migration in Supabase SQL Editor, then retry." },
          { status: 503 },
        );
      }
      return NextResponse.json({ error: "Could not publish your post. Please try again." }, { status: 502 });
    }
    return NextResponse.json({ post: { ...data, mine: true } }, { status: 201 });
  } catch (error) {
    console.error("Supabase post create is unavailable:", error);
    return NextResponse.json({ error: "Supabase is not available. Check server configuration and try again." }, { status: 503 });
  }
}
