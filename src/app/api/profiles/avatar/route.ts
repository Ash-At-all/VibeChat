import { NextResponse } from "next/server";
import { enforceRateLimit } from "@/lib/server/rate-limit";
import { getSupabaseServerClient } from "@/lib/supabase/server";

const MAX_IMAGE_BYTES = 1 * 1024 * 1024;
const MAX_REQUEST_BYTES = 7 * 1024 * 1024;
const IMAGE_SIGNATURE = new Uint8Array([0x52, 0x49, 0x46, 0x46]);
const WEBP_SIGNATURE = new Uint8Array([0x57, 0x45, 0x42, 0x50]);

class UploadRequestTooLargeError extends Error {}

function isWebp(bytes: Uint8Array) {
  return bytes.length >= 12
    && IMAGE_SIGNATURE.every((byte, index) => bytes[index] === byte)
    && WEBP_SIGNATURE.every((byte, index) => bytes[index + 8] === byte);
}

const allowedExtensions = new Set(["jpg", "jpeg", "png", "webp"]);

function allowedExtension(name: string) {
  const ext = name.split(".").pop()?.toLowerCase();
  return ext !== undefined && allowedExtensions.has(ext);
}

async function readMultipartBody(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) throw new Error("Avatar upload request is empty.");

  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > MAX_REQUEST_BYTES) {
        await reader.cancel();
        throw new UploadRequestTooLargeError("Avatar upload request is too large.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

export async function POST(request: Request) {
  const rateLimitResponse = enforceRateLimit(request, "avatars");
  if (rateLimitResponse) return rateLimitResponse;

  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > MAX_REQUEST_BYTES) {
    return NextResponse.json({ error: "Avatar upload request is too large." }, { status: 413 });
  }

  try {
    const supabase = await getSupabaseServerClient();
    const { data: userResult, error: userError } = await supabase.auth.getUser();
    if (userError || !userResult.user) {
      return NextResponse.json({ error: "Sign in to upload an avatar." }, { status: 401 });
    }

    let formData: FormData;
    try {
      const body = await readMultipartBody(request);
      const bufferedRequest = new Request(request.url, {
        method: "POST",
        headers: request.headers,
        body,
      });
      formData = await bufferedRequest.formData();
    } catch (error) {
      if (error instanceof UploadRequestTooLargeError) {
        return NextResponse.json({ error: error.message }, { status: 413 });
      }
      if (error instanceof TypeError || error instanceof SyntaxError) {
        return NextResponse.json({ error: "Could not read the avatar upload. Please try again." }, { status: 400 });
      }
      throw error;
    }

    const entries = formData.getAll("avatar");
    const files = entries.filter((entry): entry is File => typeof entry !== "string");
    if (files.length !== 1) {
      return NextResponse.json({ error: "Attach exactly one avatar image." }, { status: 400 });
    }
    const file = files[0];
    if (file.size <= 0 || file.size > MAX_IMAGE_BYTES) {
      return NextResponse.json({ error: "Avatar must be smaller than 1 MB." }, { status: 400 });
    }
    if (!allowedExtension(file.name) && !file.type.startsWith("image/")) {
      return NextResponse.json({ error: "Avatar must be a JPEG, PNG, or WebP image." }, { status: 400 });
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    if (file.type === "image/webp" && !isWebp(bytes)) {
      return NextResponse.json({ error: "The uploaded file is not a valid WebP image." }, { status: 400 });
    }

    const ext = file.name.split(".").pop()?.toLowerCase() ?? "webp";
    const path = `${userResult.user.id}/${crypto.randomUUID()}.${ext}`;
    const storage = supabase.storage.from("avatars");
    const { error } = await storage.upload(path, bytes, {
      contentType: file.type,
      cacheControl: "31536000",
      upsert: false,
    });
    if (error) {
      console.error("Supabase avatar upload failed:", error.message);
      return NextResponse.json(
        { error: `Avatar upload failed: ${error.message}` },
        { status: error.message.toLowerCase().includes("row-level security") ? 403 : 502 },
      );
    }

    const { data: urlData } = storage.getPublicUrl(path);
    return NextResponse.json({ path, url: urlData.publicUrl });
  } catch (error) {
    console.error("Avatar upload is unavailable:", error);
    return NextResponse.json({ error: "Could not upload avatar. Check Supabase configuration and try again." }, { status: 503 });
  }
}

export async function DELETE(request: Request) {
  const rateLimitResponse = enforceRateLimit(request, "avatars");
  if (rateLimitResponse) return rateLimitResponse;

  try {
    const supabase = await getSupabaseServerClient();
    const { data: userResult, error: userError } = await supabase.auth.getUser();
    if (userError || !userResult.user) {
      return NextResponse.json({ error: "Sign in to remove your avatar." }, { status: 401 });
    }

    const { data: profile, error: readError } = await supabase
      .from("profiles")
      .select("avatar_url")
      .eq("id", userResult.user.id)
      .maybeSingle();

    if (readError) {
      console.error("Supabase avatar lookup failed:", readError.message);
      return NextResponse.json({ error: "Could not remove your avatar. Please try again." }, { status: 502 });
    }

    if (profile?.avatar_url) {
      const url = new URL(profile.avatar_url);
      const marker = "/avatars/";
      const idx = url.pathname.indexOf(marker);
      const objectName = idx !== -1 ? url.pathname.slice(idx + marker.length) : null;
      if (objectName) {
        const { error: storageError } = await supabase.storage.from("avatars").remove([objectName]);
        if (storageError) {
          console.error("Supabase avatar removal failed:", storageError.message);
        }
      }
    }

    const { error } = await supabase
      .from("profiles")
      .update({ avatar_url: null })
      .eq("id", userResult.user.id);

    if (error) {
      console.error("Supabase avatar clear failed:", error.message);
      return NextResponse.json({ error: "Could not clear your avatar. Please try again." }, { status: 502 });
    }

    return NextResponse.json({ removed: true });
  } catch (error) {
    console.error("Avatar removal is unavailable:", error);
    return NextResponse.json({ error: "Could not remove avatar. Check Supabase configuration and try again." }, { status: 503 });
  }
}
