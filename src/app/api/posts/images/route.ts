import { NextResponse } from "next/server";
import { z } from "zod";
import { postImagePathSchema } from "@/lib/post-schema";
import { enforceRateLimit } from "@/lib/server/rate-limit";
import { getSupabaseServerClient } from "@/lib/supabase/server";

const MAX_IMAGES = 4;
const MAX_IMAGE_BYTES = 1.5 * 1024 * 1024;
const MAX_REQUEST_BYTES = 7 * 1024 * 1024;
const IMAGE_SIGNATURE = new Uint8Array([0x52, 0x49, 0x46, 0x46]);
const WEBP_SIGNATURE = new Uint8Array([0x57, 0x45, 0x42, 0x50]);
const imagePathListSchema = z.array(postImagePathSchema).min(1).max(MAX_IMAGES);
const cleanupRequestSchema = z.object({
  imagePaths: imagePathListSchema,
}).strict();

class UploadRequestTooLargeError extends Error {}

function isWebp(bytes: Uint8Array) {
  return bytes.length >= 12
    && IMAGE_SIGNATURE.every((byte, index) => bytes[index] === byte)
    && WEBP_SIGNATURE.every((byte, index) => bytes[index + 8] === byte);
}

async function readMultipartBody(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) throw new Error("Image upload request is empty.");

  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > MAX_REQUEST_BYTES) {
        await reader.cancel();
        throw new UploadRequestTooLargeError("Image upload request is too large.");
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
  const rateLimitResponse = enforceRateLimit(request, "postImages");
  if (rateLimitResponse) return rateLimitResponse;

  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > MAX_REQUEST_BYTES) {
    return NextResponse.json({ error: "Image upload request is too large." }, { status: 413 });
  }

  try {
    const supabase = await getSupabaseServerClient();
    const { data: userResult, error: userError } = await supabase.auth.getUser();
    if (userError || !userResult.user) {
      return NextResponse.json({ error: "Sign in with Google before uploading post images." }, { status: 401 });
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
        return NextResponse.json({ error: "Could not read the image upload. Please try again." }, { status: 400 });
      }
      throw error;
    }

    const entries = formData.getAll("images");
    const files = entries.filter((entry): entry is File => typeof entry !== "string");
    if (entries.length < 1 || entries.length > MAX_IMAGES || files.length !== entries.length) {
      return NextResponse.json({ error: "Attach between 1 and 4 valid post images." }, { status: 400 });
    }
    if (files.some((file) => file.size <= 0 || file.size > MAX_IMAGE_BYTES || file.type !== "image/webp")) {
      return NextResponse.json({ error: "Each post image must be WebP and no larger than 1.5 MB." }, { status: 400 });
    }

    const storage = supabase.storage.from("post-images");
    const uploadedPaths: string[] = [];
    for (const file of files) {
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (!isWebp(bytes)) {
        const { error: cleanupError } = uploadedPaths.length
          ? await storage.remove(uploadedPaths)
          : { error: null };
        if (cleanupError) console.error("Invalid post image cleanup failed:", cleanupError.message);
        return NextResponse.json({ error: "An attached file is not a valid WebP image." }, { status: 400 });
      }

      const path = `${userResult.user.id}/${crypto.randomUUID()}.webp`;
      const { error } = await storage.upload(path, bytes, {
        contentType: "image/webp",
        cacheControl: "31536000",
        upsert: false,
      });
      if (error) {
        console.error("Supabase post image upload failed:", error.message);
        if (uploadedPaths.length > 0) {
          const { error: cleanupError } = await storage.remove(uploadedPaths);
          if (cleanupError) console.error("Partial post image cleanup failed:", cleanupError.message);
        }
        return NextResponse.json(
          { error: `Image upload failed: ${error.message}` },
          { status: error.message.toLowerCase().includes("row-level security") ? 403 : 502 },
        );
      }
      uploadedPaths.push(path);
    }

    return NextResponse.json({ imagePaths: uploadedPaths });
  } catch (error) {
    console.error("Post image upload is unavailable:", error);
    return NextResponse.json({ error: "Could not upload post images. Check Supabase configuration and try again." }, { status: 503 });
  }
}

export async function DELETE(request: Request) {
  const rateLimitResponse = enforceRateLimit(request, "postImages");
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

  const parsed = cleanupRequestSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues.map((issue) => issue.message).join(" ") }, { status: 400 });
  }

  try {
    const supabase = await getSupabaseServerClient();
    const { data: userResult, error: userError } = await supabase.auth.getUser();
    if (userError || !userResult.user) {
      return NextResponse.json({ error: "Sign in with Google before removing post images." }, { status: 401 });
    }
    if (parsed.data.imagePaths.some((path) => !path.startsWith(`${userResult.user.id}/`))) {
      return NextResponse.json({ error: "You can only remove images you uploaded." }, { status: 403 });
    }

    const { error } = await supabase.storage.from("post-images").remove(parsed.data.imagePaths);
    if (error) {
      console.error("Supabase post image cleanup failed:", error.message);
      return NextResponse.json({ error: "Uploaded images could not be cleaned up." }, { status: 502 });
    }
    return NextResponse.json({ removed: true });
  } catch (error) {
    console.error("Post image cleanup is unavailable:", error);
    return NextResponse.json({ error: "Could not clean up uploaded images." }, { status: 503 });
  }
}
