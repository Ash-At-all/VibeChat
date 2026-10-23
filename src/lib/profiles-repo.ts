import type { Profile, ProfileDraft } from "@/lib/profile-schema";

export type PersistedProfile = {
  id: string;
  username: string;
  display_name: string;
  tag: string | null;
  avatar_url: string | null;
  created_at: string;
  updated_at: string;
};

function toProfile(row: PersistedProfile): Profile {
  return {
    id: row.id,
    username: row.username,
    display_name: row.display_name,
    tag: row.tag,
    avatar_url: row.avatar_url,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

async function readResponse<T>(response: Response): Promise<T> {
  let result: unknown;
  try {
    result = await response.json();
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error("The server returned an invalid response. Please try again.");
    }
    throw error;
  }

  if (!response.ok) {
    if (typeof result === "object" && result !== null && "error" in result && typeof result.error === "string") {
      throw new Error(result.error);
    }
    throw new Error(`The server request failed (${response.status}). Please try again.`);
  }
  return result as T;
}

export const profilesRepo = {
  async getProfile(): Promise<Profile | null> {
    const result = await readResponse<{ profile: PersistedProfile | null }>(
      await fetch(`/api/profiles`, { cache: "no-store" }),
    );
    return result.profile ? toProfile(result.profile) : null;
  },

  async getProfileByUsername(username: string): Promise<Profile | null> {
    const result = await readResponse<{ profile: PersistedProfile | null }>(
      await fetch(`/api/profiles/${encodeURIComponent(username)}`, { cache: "no-store" }),
    );
    return result.profile ? toProfile(result.profile) : null;
  },

  async upsertProfile(profile: ProfileDraft): Promise<Profile> {
    const result = await readResponse<{ profile: PersistedProfile }>(
      await fetch("/api/profiles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(profile),
      }),
    );
    return toProfile(result.profile);
  },

  async uploadAvatar(blob: Blob): Promise<string> {
    const formData = new FormData();
    formData.append("avatar", blob, "avatar.webp");
    const result = await readResponse<{ path: string; url: string }>(
      await fetch("/api/profiles/avatar", { method: "POST", body: formData }),
    );
    return result.path;
  },

  async removeAvatar(): Promise<void> {
    await readResponse<{ removed: true }>(
      await fetch("/api/profiles/avatar", { method: "DELETE" }),
    );
  },
};
