import { NextResponse } from "next/server";
import { z } from "zod";
import { citySlugSchema, messageDraftSchema } from "@/lib/post-schema";
import { readJsonBody } from "@/lib/server/json-body";
import { enforceRateLimit } from "@/lib/server/rate-limit";
import { getSupabaseServerClient } from "@/lib/supabase/server";

const MESSAGE_COLUMNS = "id, city_slug, channel_id, author_id, body, created_at";
const MAX_REQUEST_BYTES = 16 * 1024;

const locationSchema = z.object({
  city: citySlugSchema,
  channel: z.string().min(1),
});
function validateLocation(
  value: z.infer<typeof locationSchema>,
  context: z.RefinementCtx,
) {
  const validChannels = value.city === "general"
    ? ["chitchat", "meetings", "problems", "help"]
    : ["city-chat"];
  if (!validChannels.includes(value.channel)) {
    context.addIssue({
      code: "custom",
      message: "Choose a valid chat channel for this city.",
      path: ["channel"],
    });
  }
}
const listQuerySchema = locationSchema.superRefine(validateLocation);
const messageSchema = locationSchema.extend({
  body: messageDraftSchema.shape.body,
}).strict().superRefine(validateLocation);

function initials(name: string) {
  return name.split(/\s+/).slice(0, 2).map((part: string) => part[0]).join("").toUpperCase() || "CM";
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const city = url.searchParams.get("city");
  const channel = url.searchParams.get("channel");

  const parsed = listQuerySchema.safeParse({ city, channel });
  if (!parsed.success) {
    return NextResponse.json({ error: "City and channel are required." }, { status: 400 });
  }

  try {
    const supabase = await getSupabaseServerClient();
    const { data: sessionResult } = await supabase.auth.getSession();
    let authorId: string | undefined;
    if (sessionResult.session) {
      const { data: userResult } = await supabase.auth.getUser();
      if (userResult.user) authorId = userResult.user.id;
    }

    const { data, error } = await supabase
      .from("messages")
      .select(MESSAGE_COLUMNS)
      .eq("city_slug", parsed.data.city)
      .eq("channel_id", parsed.data.channel)
      .order("created_at", { ascending: true })
      .limit(100);

    if (error) {
      console.error("Supabase message list failed:", error.message);
      return NextResponse.json({ error: "Could not load messages. Please try again." }, { status: 502 });
    }

    const authorIds = [...new Set((data ?? []).map((row) => row.author_id))];
    const { data: profiles, error: profilesError } = authorIds.length
      ? await supabase.from("profiles").select("id, username, display_name").in("id", authorIds)
      : { data: [], error: null };
    if (profilesError) {
      console.error("Supabase message author lookup failed:", profilesError.message);
      return NextResponse.json({ error: "Could not load message authors. Please try again." }, { status: 502 });
    }
    const profileById = new Map((profiles ?? []).map((profile) => [profile.id, profile]));
    const messages = (data ?? []).map((row) => {
      const authorProfile = profileById.get(row.author_id);
      const author = authorProfile?.display_name || authorProfile?.username || "Community member";
      return {
        id: row.id,
        body: row.body,
        time: new Date(row.created_at).toLocaleString(),
        fromYou: row.author_id === authorId,
        author,
        author_username: authorProfile?.username ?? null,
        initials: initials(author),
      };
    });

    return NextResponse.json({ messages });
  } catch (error) {
    console.error("Message list is unavailable:", error);
    return NextResponse.json({ error: "Supabase is not available. Check server configuration and try again." }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const rateLimitResponse = enforceRateLimit(request, "messages");
  if (rateLimitResponse) return rateLimitResponse;

  const payload = await readJsonBody(request, MAX_REQUEST_BYTES);
  if (!payload.ok) return NextResponse.json({ error: payload.error }, { status: payload.status });

  const parsed = messageSchema.safeParse(payload.value);
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
      return NextResponse.json({ error: "Sign in to send a message." }, { status: 401 });
    }

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("username, display_name")
      .eq("id", userResult.user.id)
      .maybeSingle();
    if (profileError) {
      console.error("Supabase message author lookup failed:", profileError.message);
      return NextResponse.json({ error: "Could not verify your profile. Please try again." }, { status: 502 });
    }

    const { data, error } = await supabase
      .from("messages")
      .insert({
        city_slug: parsed.data.city,
        channel_id: parsed.data.channel,
        body: parsed.data.body,
      })
      .select(MESSAGE_COLUMNS)
      .single();

    if (error) {
      console.error("Supabase message create failed:", error.message);
      return NextResponse.json({ error: "Could not send your message. Please try again." }, { status: 502 });
    }

    return NextResponse.json({
      message: {
        id: data.id,
        body: data.body,
        time: new Date(data.created_at).toLocaleString(),
        fromYou: true,
        author: profile?.display_name || profile?.username || "You",
        author_username: profile?.username ?? null,
        initials: initials(profile?.display_name || profile?.username || "You"),
      },
    }, { status: 201 });
  } catch (error) {
    console.error("Message send is unavailable:", error);
    return NextResponse.json({ error: "Supabase is not available. Check server configuration and try again." }, { status: 503 });
  }
}
