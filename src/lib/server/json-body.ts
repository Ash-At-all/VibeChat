type JsonBodyResult =
  | { ok: true; value: unknown }
  | { ok: false; status: 400 | 413; error: string };

export async function readJsonBody(request: Request, maxBytes: number): Promise<JsonBodyResult> {
  const declaredLength = request.headers.get("content-length");
  if (declaredLength && Number(declaredLength) > maxBytes) {
    return { ok: false, status: 413, error: "Post request is too large." };
  }

  const reader = request.body?.getReader();
  if (!reader) return { ok: false, status: 400, error: "Request body must be valid JSON." };

  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel();
        return { ok: false, status: 413, error: "Post request is too large." };
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

  try {
    return { ok: true, value: JSON.parse(new TextDecoder().decode(body)) as unknown };
  } catch (error) {
    if (error instanceof SyntaxError) {
      return { ok: false, status: 400, error: "Request body must be valid JSON." };
    }
    throw error;
  }
}
