import Link from "next/link";
import Image from "next/image";

export const dynamic = "force-dynamic";

type Profile = {
  id: string;
  username: string;
  display_name: string;
  tag: string | null;
  avatar_url: string | null;
  created_at: string;
  updated_at: string;
};

type Post = {
  id: string;
  city_slug: string;
  tag: string;
  title: string;
  body: string;
  image_paths: string[];
  created_at: string;
  author_id: string;
};

async function fetchJson<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const res = await fetch(input, { cache: "no-store", ...init });
  if (!res.ok) throw new Error(`Request failed with ${res.status}`);
  return res.json() as Promise<T>;
}

export default async function UserProfilePage({
  params,
}: {
  params: Promise<{ username: string }>;
}) {
  const { username } = await params;
  let profile: Profile | null = null;
  let posts: Post[] = [];
  let error: string | null = null;

  try {
    const prof = await fetchJson<{ profile: Profile | null }>(
      `/api/profiles/${encodeURIComponent(username)}`,
    );
    profile = prof.profile ?? null;
    if (!profile) {
      error = "Profile not found.";
    } else {
      const data = await fetchJson<{ posts: Post[] }>(
        `/api/posts?author=${encodeURIComponent(profile.id)}`,
      );
      posts = Array.isArray(data.posts) ? data.posts : [];
    }
  } catch {
    error = "Could not load that profile. Please try again.";
  }

  if (error) {
    return (
      <div style={{ padding: 32, maxWidth: 760, margin: "0 auto", color: "#e39283" }}>
        <p>{error}</p>
        <Link href="/" style={{ color: "#d9a441", textDecoration: "underline", textUnderlineOffset: 3 }}>
          Back to community
        </Link>
      </div>
    );
  }

  if (!profile) {
    return (
      <div style={{ padding: 32, maxWidth: 760, margin: "0 auto", color: "#e39283" }}>
        <p>Profile not found.</p>
        <Link href="/" style={{ color: "#d9a441", textDecoration: "underline", textUnderlineOffset: 3 }}>
          Back to community
        </Link>
      </div>
    );
  }

  const displayName = profile.display_name || profile.username;
  const initials = profile.username
    .split(/[_\s]+/)
    .map((part: string) => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase() || "?";

  return (
    <div style={{ maxWidth: 760, margin: "0 auto", padding: 32, display: "flex", flexDirection: "column", gap: 24 }}>
      <Link href="/" style={{ color: "#a0a699", fontSize: 12, textDecoration: "underline", textUnderlineOffset: 3 }}>
        ← Back to community
      </Link>

      <header style={{ display: "flex", alignItems: "center", gap: 16, paddingBottom: 16, borderBottom: "1px solid #343830" }}>
        <div style={{
          width: 72, height: 72, borderRadius: 50, background: "#303126", color: "#e1c37f",
          fontSize: 20, fontWeight: 700, display: "grid", placeItems: "center", flex: "none",
          border: profile.avatar_url ? "none" : "1px solid #4b4c3f",
        }}>
          {profile.avatar_url ? (
            <Image
              src={profile.avatar_url}
              alt="Avatar"
              width={72}
              height={72}
              style={{ borderRadius: 50, objectFit: "cover" }}
              unoptimized
              priority
            />
          ) : (
            initials
          )}
        </div>
        <div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
            <h1 style={{ margin: 0, fontSize: 26, fontWeight: 600, letterSpacing: -0.03 }}>{profile.username}</h1>
            {displayName !== profile.username && (
              <span style={{ color: "#a0a699", fontSize: 14 }}>{displayName}</span>
            )}
            {profile.tag && (
              <span style={{
                border: "1px solid #343830", borderRadius: 4, padding: "0 7px", color: "#a0a699",
                fontSize: 11, background: "#22251f",
              }}>{profile.tag}</span>
            )}
          </div>
          <p style={{ color: "#a0a699", fontSize: 12, marginTop: 4 }}>Member of VibeChat</p>
        </div>
      </header>

      <section>
        <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>Posts by {profile.username}</h2>
        {posts.length === 0 ? (
          <p style={{ color: "#a0a699", fontSize: 13 }}>No posts yet.</p>
        ) : (
          <div style={{ display: "grid", gap: 12 }}>
            {posts.map((post) => (
              <article key={post.id} style={{
                border: "1px solid #343830", borderRadius: 6, background: "#1c1f1b", padding: 12, display: "flex", gap: 10,
              }}>
                <div style={{
                  width: 30, height: 30, borderRadius: 50, background: "#303126", color: "#e1c37f",
                  fontSize: 11, fontWeight: 700, display: "grid", placeItems: "center", flex: "none",
                  border: "1px solid #4b4c3f",
                }}>
                  {initials}
                </div>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 8, fontSize: 12 }}>
                    <span style={{ color: "#a0a699" }}>{post.tag}</span>
                  </div>
                  <h3 style={{ margin: "4px 0 2px", fontSize: 15, fontWeight: 600 }}>{post.title}</h3>
                  <p style={{ color: "#c4c6bc", fontSize: 13, margin: 0, lineHeight: 1.45 }}>{post.body}</p>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
