"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { getSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { profilesRepo } from "@/lib/profiles-repo";
import { profileSchema } from "@/lib/profile-schema";
import { processImage } from "@/lib/client-image";
import { useRouter } from "next/navigation";
import { z } from "zod";

const TAG_PRESETS = ["gamer", "coder", "creator", "traveler", "foodie", "student", "developer", "artist", "musician"];
const profileResponseSchema = z.object({
  profile: z.object({
    username: z.string(),
    display_name: z.string(),
    tag: z.string().nullable(),
    avatar_url: z.string().nullable(),
  }).nullable(),
});

export default function ProfileSetupPage() {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [profileLoading, setProfileLoading] = useState(() => isSupabaseConfigured());
  const [existingAvatarUrl, setExistingAvatarUrl] = useState<string | null>(null);
  const [avatarRemoved, setAvatarRemoved] = useState(false);
  const [editingProfile, setEditingProfile] = useState(false);
  const [error, setError] = useState<string | null>(() =>
    isSupabaseConfigured() ? null : "Supabase is not configured. Set the project URL and anon key in .env.local.",
  );
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [tag, setTag] = useState("");
  const [customTag, setCustomTag] = useState("");
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);

  useEffect(() => {
    if (!isSupabaseConfigured()) return;
    const supabase = getSupabaseBrowserClient();
    if (!supabase) {
      let active = true;
      void Promise.resolve().then(() => {
        if (!active) return;
        setError("Supabase client could not be initialized.");
        setProfileLoading(false);
      });
      return () => { active = false; };
    }
    let active = true;
    void (async () => {
      const { data, error: sessionError } = await supabase.auth.getSession();
      if (!active) return;
      if (sessionError) {
        setError("Could not restore your sign-in. Please sign in again.");
        setProfileLoading(false);
        return;
      }
      if (!data.session) {
        router.push("/");
        setProfileLoading(false);
        return;
      }
      const response = await fetch("/api/profiles", { cache: "no-store" });
      const result: unknown = await response.json();
      if (!active) return;
      if (!response.ok) {
        const message = typeof result === "object" && result !== null && "error" in result && typeof result.error === "string"
          ? result.error
          : "Could not load your profile.";
        setError(message);
        setProfileLoading(false);
        return;
      }
      const parsedProfile = profileResponseSchema.safeParse(result);
      if (!parsedProfile.success) {
        setError("The server returned an invalid profile response.");
        setProfileLoading(false);
        return;
      }
      const profile = parsedProfile.data.profile;
      if (profile) {
        setEditingProfile(true);
        setUsername(profile.username);
        setDisplayName(profile.display_name);
        setExistingAvatarUrl(profile.avatar_url);
        setAvatarPreview(profile.avatar_url);
        if (profile.tag && TAG_PRESETS.includes(profile.tag)) setTag(profile.tag);
        else setCustomTag(profile.tag ?? "");
      }
      setProfileLoading(false);
    })().catch((loadError: unknown) => {
      if (!active) return;
      setError(loadError instanceof Error ? loadError.message : "Could not load your profile.");
      setProfileLoading(false);
    });
    return () => { active = false; };
  }, [router]);

  const handleAvatarChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0] ?? null;
    if (!file) return;
    if (avatarPreview?.startsWith("blob:")) URL.revokeObjectURL(avatarPreview);
    setAvatarFile(file);
    setAvatarPreview(URL.createObjectURL(file));
    setAvatarRemoved(false);
    setError(null);
  };

  const removeAvatar = () => {
    if (avatarPreview && avatarPreview.startsWith("blob:")) URL.revokeObjectURL(avatarPreview);
    setAvatarFile(null);
    setAvatarPreview(null);
    setAvatarRemoved(true);
  };

  const selectedTag = tag || customTag;

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setSaving(true);

    try {
      const parsed = profileSchema.safeParse({
        username,
        display_name: displayName.trim(),
        tag: selectedTag || null,
      });
      if (!parsed.success) {
        setError(parsed.error.issues.map((issue) => issue.message).join(" "));
        setSaving(false);
        return;
      }

      let uploadedAvatarUrl: string | null = avatarRemoved ? null : existingAvatarUrl;
      if (avatarFile) {
        const processed = await processImage(avatarFile, "avatar");
        const path = await profilesRepo.uploadAvatar(processed.blob);
        const supabase = getSupabaseBrowserClient();
        const storage = supabase?.storage.from("avatars");
        const { data: urlData } = storage?.getPublicUrl(path) ?? {};
        uploadedAvatarUrl = urlData?.publicUrl ?? null;
      }

      if (avatarRemoved && existingAvatarUrl) await profilesRepo.removeAvatar();
      await profilesRepo.upsertProfile({
        username: parsed.data.username,
        display_name: parsed.data.display_name,
        tag: parsed.data.tag,
        avatar_url: uploadedAvatarUrl,
      });

      setSaving(false);
      router.push("/");
      router.refresh();
    } catch (error) {
      setSaving(false);
      const message = error instanceof Error ? error.message : "Could not save your profile. Please try again.";
      if (message.includes("Sign in")) {
        setError("Your session expired. Please sign in again.");
        return;
      }
      setError(message);
    }
  };

  if (error && !username && !displayName && !avatarFile && !profileLoading) {
    const sessionExpired = error.includes("expired") || error.includes("Sign in");
    return (
      <div style={{ padding: 24, maxWidth: 460, margin: "0 auto" }}>
        <p style={{ color: "#e39283" }}>{error}</p>
        {sessionExpired ? (
          <button onClick={() => router.push("/")} className="button button-primary" type="button">
            Sign in again
          </button>
        ) : (
          <button onClick={() => router.push("/")} className="button button-primary" type="button">
            Back to community
          </button>
        )}
      </div>
    );
  }

  return (
    <div style={{
      maxWidth: 460,
      margin: "0 auto",
      padding: 24,
      display: "flex",
      flexDirection: "column",
      gap: 16,
    }}>
      <h2 style={{ margin: 0, fontSize: 22, fontWeight: 600, letterSpacing: -0.03 }}>{editingProfile ? "Edit your profile" : "Set up your profile"}</h2>
      <p style={{ color: "#a0a699", fontSize: 13, margin: 0 }}>
        Choose a username, an avatar, and an optional tag. This is your public identity on VibeChat.
      </p>

      {error && (
        <p style={{ color: "#e39283", fontSize: 12, margin: 0 }}>{error}</p>
      )}

      {profileLoading ? <p style={{ color: "#a0a699", fontSize: 13 }}>Loading your profile…</p> : (
      <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <label style={{ fontSize: 12, fontWeight: 600, color: "#e7e5de" }}>Username</label>
          <input
            required
            maxLength={30}
            value={username}
            onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ""))}
            placeholder="e.g. raja_99"
            style={{ minHeight: 40, padding: "8px 10px", border: "1px solid #343830", borderRadius: 6, background: "#151714", color: "#e7e5de", font: "inherit" }}
          />
          <p style={{ fontSize: 11, color: "#a0a699", margin: 0 }}>
            Lowercase letters, numbers, and underscores only. 2–30 characters.
          </p>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <label style={{ fontSize: 12, fontWeight: 600, color: "#e7e5de" }}>Display name (optional)</label>
          <input
            maxLength={60}
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="e.g. Raj Kumar"
            style={{ minHeight: 40, padding: "8px 10px", border: "1px solid #343830", borderRadius: 6, background: "#151714", color: "#e7e5de", font: "inherit" }}
          />
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <label style={{ fontSize: 12, fontWeight: 600, color: "#e7e5de" }}>Tag (optional)</label>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {TAG_PRESETS.map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => { setTag(preset); setCustomTag(""); }}
                style={{
                  minHeight: 34,
                  padding: "5px 10px",
                  border: `1px solid ${tag === preset ? "#d9a441" : "#343830"}`,
                  borderRadius: 6,
                  background: tag === preset ? "#d9a441" : "transparent",
                  color: tag === preset ? "#211907" : "#e7e5de",
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                {preset}
              </button>
            ))}
            <button
              type="button"
              onClick={() => { setTag(""); }}
              style={{
                minHeight: 34,
                padding: "5px 10px",
                border: `1px solid ${customTag ? "#d9a441" : "#343830"}`,
                borderRadius: 6,
                background: customTag ? "#d9a441" : "transparent",
                color: customTag ? "#211907" : "#e7e5de",
                fontSize: 12,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Custom
            </button>
            <input
              maxLength={40}
              value={customTag}
              onChange={(e) => { setTag(""); setCustomTag(e.target.value); }}
              placeholder="Your own tag"
              disabled={!customTag}
              style={{
                minHeight: 34,
                padding: "8px 10px",
                border: "1px solid #343830",
                borderRadius: 6,
                background: "#151714",
                color: "#e7e5de",
                font: "inherit",
                minWidth: 120,
              }}
            />
          </div>
          <p style={{ fontSize: 11, color: "#a0a699", margin: 0 }}>
            Shown on your profile. Leave empty to skip.
          </p>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <label style={{ fontSize: 12, fontWeight: 600, color: "#e7e5de" }}>Avatar (optional)</label>
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            {avatarPreview ? (
              <div style={{ position: "relative" }}>
                <Image src={avatarPreview} alt="Avatar preview" width={88} height={88} unoptimized style={{ width: 88, height: 88, borderRadius: 50, objectFit: "cover", border: "1px solid #343830" }} />
                <button type="button" onClick={removeAvatar} style={{
                  position: "absolute", top: 2, right: 2, border: 0, borderRadius: 50, background: "#36231f",
                  color: "#e39283", width: 24, height: 24, cursor: "pointer", fontSize: 16, display: "grid", placeItems: "center"
                }}>×</button>
              </div>
            ) : (
              <div style={{ width: 88, height: 88, borderRadius: 50, border: "1px dashed #343830", background: "#22251f", display: "grid", placeItems: "center", color: "#a0a699", fontSize: 11 }}>
                No avatar
              </div>
            )}
            <label style={{ minHeight: 40, padding: "8px 13px", border: "1px solid #d9a441", borderRadius: 6, background: "#d9a441", color: "#211907", fontWeight: 600, fontSize: 13, cursor: "pointer", textAlign: "center" }}>
              Choose image
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                style={{ position: "absolute", width: 1, height: 1, padding: 0, margin: -1, overflow: "hidden", clip: "rect(0,0,0,0)", whiteSpace: "nowrap", border: 0 }}
                onChange={handleAvatarChange}
              />
            </label>
            <p style={{ fontSize: 11, color: "#a0a699", margin: 0 }}>
              JPEG, PNG or WebP · up to 1 MB · compressed to WebP, max 512×512
            </p>
          </div>
        </div>

        <div style={{ marginTop: 8 }}>
          <button type="submit" disabled={saving || !username} className="button button-primary" style={{ minHeight: 44, width: "100" }}>
            {saving ? "Saving…" : editingProfile ? "Save profile" : "Save profile & continue"}
          </button>
          {!saving && !username && <span style={{ fontSize: 11, color: "#a0a699" }}>Choose a username to continue.</span>}
        </div>
      </form>
      )}
    </div>
  );
}
