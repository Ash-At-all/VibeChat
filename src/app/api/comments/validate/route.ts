import { NextResponse } from "next/server";
import { commentDraftSchema } from "@/lib/post-schema";
import { enforceRateLimit } from "@/lib/server/rate-limit";

export async function POST(request: Request) {
  const rateLimitResponse = enforceRateLimit(request, "comments");
  if (rateLimitResponse) return rateLimitResponse;

  let payload: unknown;
  try {
    payload = await request.json();
  } catch (error) {
    if (error instanceof SyntaxError) {
      return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
    }
    throw error;
  }

  const parsed = commentDraftSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues.map((issue) => issue.message).join(" ") },
      { status: 400 },
    );
  }

  return NextResponse.json({ valid: true });
}
