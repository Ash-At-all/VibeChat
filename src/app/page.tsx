"use client";

import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { FormEvent, KeyboardEvent, ReactNode, useEffect, useMemo, useRef, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { z } from "zod";
import { SiteBrand } from "@/components/site-brand";
import { CITIES } from "@/lib/cities";
import { postsRepo, type PersistedPost } from "@/lib/posts-repo";
import { profilesRepo } from "@/lib/profiles-repo";
import { type Profile } from "@/lib/profile-schema";
import { getSupabaseBrowserClient, getSupabaseConfigError, isSupabaseConfigured } from "@/lib/supabase/client";
import {
  commentDraftSchema,
  messageDraftSchema,
  POST_TAGS,
  postDraftSchema,
  postEditSchema,
  postTagSchema,
  type PostTag,
} from "@/lib/post-schema";
import { processImage } from "@/lib/client-image";

type LocalImage = { url: string; name: string; size: number; width: number; height: number; blob?: Blob };
type CommentItem = {
  id: string;
  author: string;
  author_username?: string | null;
  body: string;
  replies: CommentItem[];
};
type Post = {
  id: string;
  city: string;
  author: string;
  author_username?: string | null;
  initials: string;
  time: string;
  avatar_url?: string | null;
  tag: string;
  title: string;
  body: string;
  images?: LocalImage[];
  votes: number;
  comments: CommentItem[];
  mine?: boolean;
};
type Message = { id: string; body: string; time: string; fromYou: boolean; author: string; author_username: string | null; initials: string };
type Channel = { id: string; label: string };
type SafetyTarget = { type: "post" | "comment"; id: string; author: string; authorUsername?: string | null; label: string; targetContent?: string };
type BlockedAccount = { username: string; name: string };
type SafetyReport = SafetyTarget & {
  reportId: string;
  reason: string;
  details: string;
  status: "open" | "reviewed" | "actioned";
};
type PendingShare = {
  kind: "post" | "message" | "comment";
  text: string;
  postId?: string;
  parentId?: string;
};

const GENERAL_CHANNELS: Channel[] = [
  { id: "chitchat", label: "Chit-chat" },
  { id: "meetings", label: "Meetings" },
  { id: "problems", label: "Problem-solving" },
  { id: "help", label: "Help" },
];
const CITY_CHANNELS: Channel[] = [{ id: "city-chat", label: "City chat" }];
const messageResponseSchema = z.object({
  messages: z.array(z.object({
    id: z.string(),
    body: z.string(),
    time: z.string(),
    fromYou: z.boolean(),
    author: z.string(),
    author_username: z.string().nullable(),
    initials: z.string(),
  })),
});
const reportsResponseSchema = z.object({
  isModerator: z.boolean(),
  reports: z.array(z.object({
    id: z.string(),
    type: z.enum(["post", "comment"]),
    targetId: z.string(),
    targetContent: z.string(),
    reason: z.string(),
    details: z.string(),
    status: z.enum(["open", "reviewed", "actioned"]),
  })),
});
const blocksResponseSchema = z.object({
  blocked: z.array(z.object({ username: z.string(), name: z.string() })),
});
const commentResponseSchema = z.object({
  comment: z.object({
    id: z.string(),
    author: z.string(),
    author_username: z.string().nullable().optional(),
    body: z.string(),
  }),
});
const reportResponseSchema = z.object({
  report: z.object({
    id: z.string(),
    reason: z.string(),
    details: z.string(),
    status: z.enum(["open", "reviewed", "actioned"]),
  }),
});
function includesPersonalInfo(value: string) {
  const phone = /(?:\+?\d[\d().\s-]{8,}\d)/;
  const address = /\b(?:my address|i live at|street address|flat number|apartment number|house number|postal address)\b/i;
  return phone.test(value) || address.test(value);
}

function addReply(
  comments: CommentItem[],
  parentId: string,
  reply: CommentItem,
): CommentItem[] {
  return comments.map((comment) =>
    comment.id === parentId
      ? { ...comment, replies: [...comment.replies, reply] }
      : { ...comment, replies: addReply(comment.replies, parentId, reply) },
  );
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

function toPost(row: PersistedPost, userId?: string, profile: Profile | null = null): Post {
  const mine = row.mine === true || (userId !== undefined && row.author_id === userId);
  const author = mine ? (profile?.display_name || profile?.username || "You") : row.author || "Community member";
  const createdAt = new Date(row.created_at);
  const storage = getSupabaseBrowserClient()?.storage.from("post-images");
  const mineInitials = mine && profile
    ? (profile.display_name || profile.username)
      .split(/[_\s]+/)
      .map((part: string) => part[0])
      .filter(Boolean)
      .slice(0, 2)
      .join("")
      .toUpperCase() || "YO"
    : "YO";
  return {
    id: row.id,
    city: row.city_slug,
    author,
    author_username: mine ? profile?.username ?? row.author_username : row.author_username,
    initials: mine ? mineInitials : initials(author),
    avatar_url: mine ? profile?.avatar_url ?? row.avatar_url ?? null : row.avatar_url ?? null,
    time: Number.isNaN(createdAt.getTime()) ? "Recently" : createdAt.toLocaleString(),
    tag: row.tag,
    title: row.title,
    body: row.body,
    images: row.image_paths.map((path) => {
      return {
        url: storage?.getPublicUrl(path).data.publicUrl ?? "",
        name: "Community post image",
        size: 0,
        width: 1600,
        height: 1200,
      };
    }).filter((image) => image.url.length > 0),
    votes: row.votes ?? 0,
    comments: row.comments ?? [],
    mine,
  };
}

export default function Home() {
  const [joined, setJoined] = useState<string[]>(["general"]);
  const [favourites, setFavourites] = useState<string[]>([]);
  const [citySlug, setCitySlug] = useState("general");
  const [channelId, setChannelId] = useState("chitchat");
  const [mobileView, setMobileView] = useState<"board" | "chat">("chat");
  const [citySearch, setCitySearch] = useState("");
  const [postSearch, setPostSearch] = useState("");
  const [posts, setPosts] = useState<Post[]>([]);
  const [postImages, setPostImages] = useState<LocalImage[]>([]);
  const [messages, setMessages] = useState<Record<string, Message[]>>({});
  const [postLoadResult, setPostLoadResult] = useState<{ city: string; error: string | null } | null>(null);
  const [postsRefresh, setPostsRefresh] = useState(0);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const currentUserId = currentUser?.id ?? null;
  const [profileState, setProfileState] = useState<{ userId: string; profile: Profile | null } | null>(null);
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [newPostOpen, setNewPostOpen] = useState(false);
  const [postTitle, setPostTitle] = useState("");
  const [postBody, setPostBody] = useState("");
  const [postTag, setPostTag] = useState<PostTag>("General");
  const [chatDraft, setChatDraft] = useState("");
  const [chatCooldown, setChatCooldown] = useState(false);
  const [commentDrafts, setCommentDrafts] = useState<Record<string, string>>({});
  const [replyDraft, setReplyDraft] = useState("");
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [expandedPosts, setExpandedPosts] = useState<string[]>([]);
  const [votes, setVotes] = useState<Record<string, number>>({});
  const [blockedState, setBlockedState] = useState<{ userId: string; accounts: BlockedAccount[] } | null>(null);
  const [editingPost, setEditingPost] = useState<string | null>(null);
  const [editTitleDraft, setEditTitleDraft] = useState("");
  const [editDraft, setEditDraft] = useState("");
  const [safetyReports, setSafetyReports] = useState<SafetyReport[]>([]);
  const [reportTarget, setReportTarget] = useState<SafetyTarget | null>(null);
  const [reportReason, setReportReason] = useState("");
  const [reportDetails, setReportDetails] = useState("");
  const [safetyCenterOpen, setSafetyCenterOpen] = useState(false);
  const [moderatorView, setModeratorView] = useState(false);
  const [pendingShare, setPendingShare] = useState<PendingShare | null>(null);
  const [notice, setNotice] = useState<{ kind: "error" | "success"; text: string } | null>(null);
  const [authOpen, setAuthOpen] = useState(false);
  const [leftRailOpen, setLeftRailOpen] = useState(false);
  const [rightRailOpen, setRightRailOpen] = useState(false);
  const [chatLoading, setChatLoading] = useState(false);
  const [chatLoadError, setChatLoadError] = useState<string | null>(null);
  const [chatError, setChatError] = useState<string | null>(null);
  const mainRef = useRef<HTMLElement>(null);
  const chatLogRef = useRef<HTMLDivElement>(null);
  const imageUrls = useRef(new Set<string>());
  const previousFocus = useRef<HTMLElement | null>(null);
  const router = useRouter();
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const profile = profileState?.userId === currentUserId ? profileState.profile : null;

  useEffect(() => () => {
    for (const url of imageUrls.current) URL.revokeObjectURL(url);
    imageUrls.current.clear();
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const storedJoined: unknown = JSON.parse(localStorage.getItem("vibechat-joined-cities") ?? "[]");
        const storedFavourites: unknown = JSON.parse(localStorage.getItem("vibechat-favourites") ?? "[]");
        if (Array.isArray(storedJoined)) {
          setJoined(["general", ...storedJoined.filter((slug): slug is string =>
            typeof slug === "string" && slug !== "general" && CITIES.some((item) => item.slug === slug),
          )]);
        }
        if (Array.isArray(storedFavourites)) {
          setFavourites(storedFavourites.filter((slug): slug is string =>
            typeof slug === "string" && CITIES.some((item) => item.slug === slug),
          ));
        }
      } catch {
        setNotice({ kind: "error", text: "Could not load saved city preferences. Check this browser's storage settings." });
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!isSupabaseConfigured()) return;

    let active = true;
    let authErrorTimer: number | undefined;
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return;

    void supabase.auth.getSession().then(({ data, error }) => {
      if (!active) return;
      if (error) setAuthError("Could not restore your sign-in. Please try signing in again.");
      setCurrentUser(data.session?.user ?? null);
    });
    const { data: authListener } = supabase.auth.onAuthStateChange((_event, session) => {
      setCurrentUser(session?.user ?? null);
      if (!session) setProfileState(null);
      setAuthError(null);
    });

    const query = new URLSearchParams(window.location.search);
    const callbackError = query.get("auth_error");
    if (callbackError) {
      const message = callbackError === "missing_code"
        ? "Google sign-in did not return an authorization code. Please try again."
        : "Google sign-in could not be completed. Check your Supabase Google provider settings and try again.";
      authErrorTimer = window.setTimeout(() => {
        if (active) {
          setAuthError(message);
          setAuthOpen(true);
        }
      }, 0);
      window.history.replaceState({}, "", window.location.pathname);
    }

    return () => {
      active = false;
      if (authErrorTimer !== undefined) window.clearTimeout(authErrorTimer);
      authListener.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    let active = true;
    if (!isSupabaseConfigured() || !currentUserId) return () => { active = false; };
    void profilesRepo.getProfile()
      .then((p) => {
        if (!active) return;
        setProfileState({ userId: currentUserId, profile: p });
        if (!p) router.push("/profile");
      })
      .catch((error: unknown) => {
        if (active) {
          setNotice({
            kind: "error",
            text: error instanceof Error ? error.message : "Could not load your profile.",
          });
        }
      });
    return () => { active = false; };
  }, [currentUserId, router]);

  useEffect(() => {
    if (!currentUserId) return;
    let active = true;
    void fetch("/api/blocks", { cache: "no-store" })
      .then(async (response) => {
        const result: unknown = await response.json();
        if (!response.ok) {
          const message = typeof result === "object" && result !== null && "error" in result && typeof result.error === "string"
            ? result.error
            : "Could not load blocked accounts.";
          throw new Error(message);
        }
        const parsed = blocksResponseSchema.safeParse(result);
        if (!parsed.success) throw new Error("The server returned an invalid block list.");
        if (active) setBlockedState({ userId: currentUserId, accounts: parsed.data.blocked });
      })
      .catch((error: unknown) => {
        if (active) setNotice({ kind: "error", text: error instanceof Error ? error.message : "Could not load blocked accounts." });
      });
    return () => { active = false; };
  }, [currentUserId]);

  useEffect(() => {
    if (!isSupabaseConfigured()) return;
    let active = true;
    void postsRepo.listPosts(citySlug === "general" ? undefined : citySlug)
      .then((rows) => {
        if (active) {
          setPosts(rows.map((row) => toPost(row, currentUserId ?? undefined, profile)));
          setVotes(Object.fromEntries(rows.map((row) => [row.id, row.user_vote ?? 0])));
          setPostLoadResult({ city: citySlug, error: null });
        }
      })
      .catch((error: unknown) => {
        if (active) {
          setPostLoadResult({
            city: citySlug,
            error: error instanceof Error ? error.message : "Could not load posts. Please try again.",
          });
        }
      });
    return () => {
      active = false;
    };
  }, [citySlug, currentUserId, postsRefresh, profile]);

  useEffect(() => {
    let active = true;
    const key = `${citySlug}:${channelId}`;
    async function loadMessages(showLoading = false) {
      if (!isSupabaseConfigured()) {
        setChatLoadError("Set up Supabase to load and send shared messages.");
        setChatLoading(false);
        return;
      }
      if (showLoading) setChatLoading(true);
      try {
        const response = await fetch(
          `/api/messages?city=${encodeURIComponent(citySlug)}&channel=${encodeURIComponent(channelId)}`,
          { cache: "no-store" },
        );
        const data: unknown = await response.json();
        if (!response.ok) {
          const message = typeof data === "object" && data !== null && "error" in data && typeof data.error === "string"
            ? data.error
            : "Could not load messages. Please try again.";
          throw new Error(message);
        }
        const parsed = messageResponseSchema.safeParse(data);
        if (!parsed.success) {
          throw new Error("The server returned an invalid message response.");
        }
        if (!active) return;
        const nextMessages = parsed.data.messages.map((message) => ({
          id: message.id,
          body: message.body,
          time: message.time,
          fromYou: message.fromYou,
          author: message.author,
          author_username: message.author_username,
          initials: message.initials,
        }));
        setMessages((current) => {
          const previous = current[key] ?? [];
          const unchanged = previous.length === nextMessages.length
            && previous.every((message, index) => {
              const next = nextMessages[index];
              return message.id === next.id
                && message.body === next.body
                && message.time === next.time
                && message.fromYou === next.fromYou
                && message.author === next.author
                && message.author_username === next.author_username
                && message.initials === next.initials;
            });
          return unchanged ? current : { ...current, [key]: nextMessages };
        });
        setChatLoadError(null);
      } catch (error) {
        if (active) {
          setChatLoadError(error instanceof Error ? error.message : "Could not load messages. Please try again.");
        }
      } finally {
        if (active) setChatLoading(false);
      }
    }

    void loadMessages(true);
    const refresh = window.setInterval(() => void loadMessages(), 5000);
    return () => {
      active = false;
      window.clearInterval(refresh);
    };
  }, [citySlug, channelId]);

  const blockedAuthors = useMemo(
    () => blockedState?.userId === currentUserId ? blockedState.accounts : [],
    [blockedState, currentUserId],
  );
  const loading = isSupabaseConfigured() && postLoadResult?.city !== citySlug;
  const postsError = !isSupabaseConfigured()
    ? "Configure Supabase to load shared community posts."
    : postLoadResult?.city === citySlug ? postLoadResult.error : null;
  const city = CITIES.find((item) => item.slug === citySlug) ?? CITIES[0];
  const channels = city.slug === "general" ? GENERAL_CHANNELS : CITY_CHANNELS;
  const primaryChannel = channels[0];
  const visiblePosts = useMemo(
    () =>
      posts.filter((post) => {
        const matchesCity = citySlug === "general" || post.city === citySlug;
        const query = postSearch.trim().toLocaleLowerCase();
        const matchesSearch =
          !query ||
          `${post.title} ${post.body} ${post.tag} ${post.author}`
            .toLocaleLowerCase()
            .includes(query);
        return matchesCity && matchesSearch
          && !blockedAuthors.some((blocked) => blocked.username === post.author_username);
      }),
    [blockedAuthors, citySlug, postSearch, posts],
  );
  const cityMatches = CITIES.filter((item) =>
    `${item.name} ${item.region}`.toLocaleLowerCase().includes(citySearch.trim().toLocaleLowerCase()),
  ).sort((a, b) => a.name.localeCompare(b.name));
  const blockedUsernames = useMemo(
    () => new Set(blockedAuthors.map((account) => account.username)),
    [blockedAuthors],
  );
  const currentMessages = useMemo(
    () => (messages[`${citySlug}:${channelId}`] ?? [])
      .filter((message) => !message.author_username || !blockedUsernames.has(message.author_username)),
    [blockedUsernames, channelId, citySlug, messages],
  );

  async function updateBlock(username: string, blocked: boolean) {
    if (!currentUser) {
      setAuthOpen(true);
      setNotice({ kind: "error", text: "Sign in to block or unblock accounts." });
      return;
    }
    const userId = currentUser.id;
    try {
      const response = await fetch("/api/blocks", {
        method: blocked ? "POST" : "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username }),
      });
      const result: unknown = await response.json();
      if (!response.ok) {
        const message = typeof result === "object" && result !== null && "error" in result && typeof result.error === "string"
          ? result.error
          : "Could not update your blocked accounts.";
        throw new Error(message);
      }
      if (blocked) {
        const parsed = z.object({ blocked: z.object({ username: z.string(), name: z.string() }) }).safeParse(result);
        if (!parsed.success) throw new Error("The server returned an invalid block response.");
        setBlockedState((current) => {
          const accounts = current?.userId === userId ? current.accounts : [];
          return {
            userId,
            accounts: [...accounts.filter((account) => account.username !== username), parsed.data.blocked],
          };
        });
        setNotice({ kind: "success", text: `${parsed.data.blocked.name} has been blocked.` });
      } else {
        setBlockedState((current) => ({
          userId,
          accounts: current?.userId === userId
            ? current.accounts.filter((account) => account.username !== username)
            : [],
        }));
        setNotice({ kind: "success", text: `${username} has been unblocked.` });
      }
    } catch (error) {
      setNotice({ kind: "error", text: error instanceof Error ? error.message : "Could not update your blocked accounts." });
    }
  }

  async function moderateReport(reportId: string, status: "reviewed" | "actioned") {
    try {
      const response = await fetch("/api/reports", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: reportId, status }),
      });
      const result: unknown = await response.json();
      if (!response.ok) {
        const message = typeof result === "object" && result !== null && "error" in result && typeof result.error === "string"
          ? result.error
          : "Could not update the report.";
        throw new Error(message);
      }
      setSafetyReports((current) => current.map((report) =>
        report.reportId === reportId ? { ...report, status } : report,
      ));
      setNotice({ kind: "success", text: `Report marked ${status}.` });
    } catch (error) {
      setNotice({ kind: "error", text: error instanceof Error ? error.message : "Could not update the report." });
    }
  }

  function openReport(target: SafetyTarget) {
    setReportTarget(target);
    setReportReason("");
    setReportDetails("");
  }

  async function submitReport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!reportTarget || !reportReason) return;
    try {
      const response = await fetch("/api/reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: reportTarget.type,
          targetId: reportTarget.id,
          reason: reportReason,
          details: reportDetails.trim(),
        }),
      });
      const result: unknown = await response.json();
      if (!response.ok) {
        const message = typeof result === "object" && result !== null && "error" in result && typeof result.error === "string"
          ? result.error
          : "Could not submit your report. Please try again.";
        throw new Error(message);
      }
      const parsedResult = reportResponseSchema.safeParse(result);
      if (!parsedResult.success) {
        throw new Error("The server returned an invalid report response.");
      }
      const saved = parsedResult.data.report;
      setSafetyReports((current) => [{
        ...reportTarget,
        reportId: saved.id,
        reason: saved.reason,
        details: saved.details,
        status: saved.status,
      }, ...current]);
      setReportTarget(null);
      setSafetyCenterOpen(true);
      setNotice({ kind: "success", text: "Your report was submitted to the community safety team." });
    } catch (error) {
      setNotice({ kind: "error", text: error instanceof Error ? error.message : "Could not submit your report." });
    }
  }

  useEffect(() => {
    const log = chatLogRef.current;
    if (log && currentMessages.length > 0) {
      log.scrollTo({ top: log.scrollHeight, behavior: "smooth" });
    }
  }, [currentMessages]);

  useEffect(() => {
    if (!safetyCenterOpen) return;
    let active = true;
    void fetch("/api/reports", { cache: "no-store" })
      .then(async (response) => {
        const result: unknown = await response.json();
        if (!response.ok) {
          const message = typeof result === "object" && result !== null && "error" in result && typeof result.error === "string"
            ? result.error
            : "Could not load your reports.";
          throw new Error(message);
        }
        const parsed = reportsResponseSchema.safeParse(result);
        if (!parsed.success) {
          throw new Error("The server returned an invalid report response.");
        }
        if (!active) return;
        setModeratorView(parsed.data.isModerator);
        setSafetyReports(parsed.data.reports.map((report) => ({
          type: report.type,
          id: report.targetId,
          author: "Community member",
          authorUsername: null,
          label: `${report.type} · ${String(report.targetId).slice(0, 8)}`,
          targetContent: report.targetContent,
          reportId: report.id,
          reason: report.reason,
          details: report.details,
          status: report.status,
        })));
      })
      .catch((error: unknown) => {
        if (active) setNotice({ kind: "error", text: error instanceof Error ? error.message : "Could not load your reports." });
      });
    return () => { active = false; };
  }, [safetyCenterOpen]);

  useEffect(() => {
    if (noticeTimer.current) {
      clearTimeout(noticeTimer.current);
      noticeTimer.current = null;
    }
    if (notice?.kind === "success") {
      noticeTimer.current = setTimeout(() => setNotice(null), 5000);
    }
    return () => {
      if (noticeTimer.current) clearTimeout(noticeTimer.current);
    };
  }, [notice]);

  useEffect(() => {
    const anyModalOpen =
      authOpen ||
      reportTarget !== null ||
      safetyCenterOpen ||
      pendingShare !== null;
    if (anyModalOpen) {
      previousFocus.current = document.activeElement as HTMLElement | null;
      return;
    }
    if (previousFocus.current) {
      previousFocus.current.focus({ preventScroll: true });
      previousFocus.current = null;
    }
  }, [authOpen, reportTarget, safetyCenterOpen, pendingShare]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const raw = localStorage.getItem(`vibechat-draft-post-${citySlug}`);
        if (raw) {
          const draft = JSON.parse(raw);
          if (draft && typeof draft === "object") {
            if (typeof draft.title === "string") setPostTitle(draft.title);
            if (typeof draft.body === "string") setPostBody(draft.body);
            if (POST_TAGS.includes(draft.tag)) setPostTag(draft.tag);
          }
        }
      } catch {}
    }, 0);
    return () => window.clearTimeout(timer);
  }, [citySlug]);

  useEffect(() => {
    try {
      localStorage.setItem(
        `vibechat-draft-post-${citySlug}`,
        JSON.stringify({ title: postTitle, body: postBody, tag: postTag }),
      );
    } catch {}
  }, [citySlug, postTitle, postBody, postTag]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const raw = localStorage.getItem(`vibechat-draft-chat-${citySlug}:${channelId}`);
        if (raw) {
          const draft = JSON.parse(raw);
          if (draft && typeof draft === "object" && typeof draft.body === "string") {
            setChatDraft(draft.body);
          }
        }
      } catch {}
    }, 0);
    return () => window.clearTimeout(timer);
  }, [citySlug, channelId]);

  useEffect(() => {
    try {
      localStorage.setItem(
        `vibechat-draft-chat-${citySlug}:${channelId}`,
        JSON.stringify({ body: chatDraft }),
      );
    } catch {}
  }, [citySlug, channelId, chatDraft]);

  function selectCity(slug: string) {
    setCitySlug(slug);
    setMobileView("chat");
    setPostSearch("");
    setChannelId(slug === "general" ? "chitchat" : "city-chat");
  }

  function showMobileView(view: "board" | "chat") {
    setMobileView(view);
    mainRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function joinCity(slug: string) {
    const nextJoined = joined.includes(slug) ? joined : [...joined, slug];
    setJoined(nextJoined);
    savePreferences(nextJoined, favourites);
    selectCity(slug);
    setCitySearch("");
    setNotice({ kind: "success", text: `${CITIES.find((item) => item.slug === slug)?.name} added to your cities.` });
  }

  function leaveCity(slug: string) {
    if (slug === "general") return;
    const nextJoined = joined.filter((item) => item !== slug);
    const nextFavourites = favourites.filter((item) => item !== slug);
    setJoined(nextJoined);
    setFavourites(nextFavourites);
    savePreferences(nextJoined, nextFavourites);
    if (citySlug === slug) selectCity("general");
  }

  function savePreferences(nextJoined: string[], nextFavourites: string[]) {
    try {
      localStorage.setItem("vibechat-joined-cities", JSON.stringify(nextJoined));
      localStorage.setItem("vibechat-favourites", JSON.stringify(nextFavourites));
    } catch {
      setNotice({ kind: "error", text: "Could not save city preferences in this browser." });
    }
  }

  function toggleFavourite(slug: string) {
    const nextFavourites = favourites.includes(slug)
      ? favourites.filter((item) => item !== slug)
      : [...favourites, slug];
    setFavourites(nextFavourites);
    savePreferences(joined, nextFavourites);
  }

  async function validateOnServer(path: string, payload: unknown, contentType: string) {
    try {
      const response = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result: unknown = await response.json();
      if (!response.ok) {
        if (typeof result === "object" && result !== null && "error" in result && typeof result.error === "string") {
          return result.error;
        }
        return `The server rejected this ${contentType}. Please review it and try again.`;
      }
      if (typeof result !== "object" || result === null || !("valid" in result) || result.valid !== true) {
        return "The server returned an invalid response. Please try again.";
      }
      return null;
    } catch (error) {
      if (error instanceof TypeError) {
        return `Could not reach the server to validate this ${contentType}. Please try again.`;
      }
      if (error instanceof SyntaxError) {
        return "The server returned an invalid response. Please try again.";
      }
      throw error;
    }
  }

  async function publishPost(input: unknown) {
    const parsed = postDraftSchema.safeParse(input);
    if (!parsed.success) {
      setNotice({ kind: "error", text: parsed.error.issues.map((issue) => issue.message).join(" ") });
      return;
    }

    if (!isSupabaseConfigured()) {
      setNotice({ kind: "error", text: "Configure Supabase before publishing community posts." });
      return;
    }
    if (!currentUser) {
      setAuthError(null);
      setAuthOpen(true);
      setNotice({ kind: "error", text: "Sign in with Google before publishing a shared post." });
      return;
    }
    let uploadedPaths: string[] = [];
    try {
      if (postImages.length > 0) {
        const blobs = postImages.map((image) => {
          if (!image.blob) throw new Error("One of the selected images is no longer available. Please attach it again.");
          return image.blob;
        });
        uploadedPaths = await postsRepo.uploadPostImages(blobs);
      }

      const row = await postsRepo.createPost(parsed.data, uploadedPaths);
      setPosts((current) => [toPost(row, currentUser.id, profile), ...current]);
      setPostTitle("");
      setPostBody("");
      for (const image of postImages) {
        if (image.url.startsWith("blob:")) URL.revokeObjectURL(image.url);
        imageUrls.current.delete(image.url);
      }
      setPostImages([]);
      setNewPostOpen(false);
      setNotice({ kind: "success", text: "Post published to the community." });
    } catch (error) {
      let message = error instanceof Error ? error.message : "Could not publish your post.";
      if (uploadedPaths.length > 0) {
        try {
          await postsRepo.removePostImages(uploadedPaths);
        } catch (cleanupError) {
          console.error("Uploaded post images could not be cleaned up:", cleanupError);
          message += " Some uploaded images could not be cleaned up.";
        }
      }
      setNotice({ kind: "error", text: message });
    }
  }

  function submitPost(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = postDraftSchema.safeParse({
      city: citySlug,
      title: postTitle,
      body: postBody,
      tag: postTag,
    });
    if (!parsed.success) {
      setNotice({ kind: "error", text: parsed.error.issues.map((issue) => issue.message).join(" ") });
      return;
    }
    if (includesPersonalInfo(`${parsed.data.title} ${parsed.data.body}`)) {
      setPendingShare({ kind: "post", text: `${parsed.data.title}\n${parsed.data.body}` });
      return;
    }
    publishPost(parsed.data);
  }

  async function savePostEdit(event: FormEvent<HTMLFormElement>, postId: string) {
    event.preventDefault();
    const parsed = postEditSchema.safeParse({ title: editTitleDraft, body: editDraft });
    if (!parsed.success) {
      setNotice({ kind: "error", text: parsed.error.issues.map((issue) => issue.message).join(" ") });
      return;
    }

    if (!isSupabaseConfigured()) {
      setNotice({ kind: "error", text: "Configure Supabase before editing community posts." });
      return;
    }
    try {
      const saved = await postsRepo.updatePost(postId, parsed.data);
      setPosts((current) => current.map((post) =>
        post.id === postId ? { ...post, title: saved.title, body: saved.body } : post,
      ));
      setEditingPost(null);
      setNotice({ kind: "success", text: "Post updated." });
    } catch (error) {
      setNotice({ kind: "error", text: error instanceof Error ? error.message : "Could not update your post." });
    }
  }

  async function deletePost(post: Post) {
    if (!isSupabaseConfigured()) {
      setNotice({ kind: "error", text: "Configure Supabase before deleting community posts." });
      return;
    }
    let cleanupWarning: string | null;
    try {
      cleanupWarning = await postsRepo.deletePost(post.id);
    } catch (error) {
      setNotice({ kind: "error", text: error instanceof Error ? error.message : "Could not delete your post." });
      return;
    }
    post.images?.forEach((image) => {
      if (image.url.startsWith("blob:")) URL.revokeObjectURL(image.url);
      imageUrls.current.delete(image.url);
    });
    setPosts((current) => current.filter((item) => item.id !== post.id));
    setNotice(cleanupWarning
      ? { kind: "error", text: cleanupWarning }
      : { kind: "success", text: "Post deleted." });
  }

  async function signInWithGoogle() {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) {
      setAuthError(getSupabaseConfigError() ?? "Supabase client could not be initialized.");
      return;
    }

    setAuthLoading(true);
    setAuthError(null);
    const redirectTo = `${window.location.origin}/auth/callback?next=/`;
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo },
    });
    if (error) {
      setAuthError(error.message);
      setAuthLoading(false);
    }
  }

  async function signOut() {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) {
      setNotice({ kind: "error", text: "Supabase is not configured." });
      return;
    }
    const { error } = await supabase.auth.signOut();
    if (error) {
      setNotice({ kind: "error", text: `Could not sign out: ${error.message}` });
      return;
    }
    setNotice({ kind: "success", text: "You have signed out." });
  }

  async function sendMessage(text: string) {
    if (!isSupabaseConfigured()) {
      setChatError("Configure Supabase before sending shared messages.");
      return;
    }
    if (!currentUser) {
      setAuthOpen(true);
      setChatError("Sign in to send a message.");
      return;
    }
    const body = text;
    const parsed = messageDraftSchema.safeParse({ body });
    if (!parsed.success) {
      setChatError(parsed.error.issues.map((issue) => issue.message).join(" "));
      return;
    }

    const validationError = await validateOnServer("/api/messages/validate", parsed.data, "message");
    if (validationError) {
      setChatError(validationError);
      return;
    }

    try {
      const response = await fetch("/api/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ city: citySlug, channel: channelId, body: parsed.data.body }),
      });
      if (!response.ok) {
        const result = await response.json().catch(() => ({}));
        throw new Error(typeof result.error === "string" ? result.error : "Could not send your message.");
      }
      const result = await response.json();
      const key = `${citySlug}:${channelId}`;
      setMessages((current) => ({
        ...current,
        [key]: [...(current[key] ?? []), {
          id: result.message.id,
          body: result.message.body,
          time: result.message.time,
          fromYou: true,
          author: result.message.author,
          author_username: result.message.author_username ?? null,
          initials: result.message.initials,
        }],
      }));
      setChatDraft("");
      setChatError(null);
      setChatCooldown(true);
      window.setTimeout(() => setChatCooldown(false), 3000);
    } catch (error) {
      setChatError(error instanceof Error ? error.message : "Your message could not be sent. Please try again.");
    }
  }

  function submitMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (chatCooldown) return;
    const text = chatDraft.trim();
    if (!text) return;
    if (includesPersonalInfo(text)) {
      setPendingShare({ kind: "message", text });
      return;
    }
    void sendMessage(text);
  }

  async function attachImages(files: FileList | null, purpose: "post") {
    if (!files?.length) return;
    const selectedFiles = Array.from(files);
    if (purpose === "post" && postImages.length + selectedFiles.length > 4) {
      setNotice({ kind: "error", text: "A post can include up to 4 images." });
      return;
    }
    for (const file of selectedFiles) {
      try {
        const processed = await processImage(file, purpose);
        const url = URL.createObjectURL(processed.blob);
        imageUrls.current.add(url);
        const localImage = {
          url,
          name: file.name,
          size: processed.blob.size,
          width: processed.width,
          height: processed.height,
          blob: processed.blob,
        };
        setPostImages((current) => [...current, localImage]);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Image processing failed. Please try another image.";
        setNotice({ kind: "error", text: message });
      }
    }
  }

  function removeLocalImage(image: LocalImage) {
    if (image.url.startsWith("blob:")) URL.revokeObjectURL(image.url);
    imageUrls.current.delete(image.url);
    setPostImages((current) => current.filter((item) => item.url !== image.url));
  }

  function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  }

  async function addComment(postId: string, text: string, parentId?: string) {
    if (!isSupabaseConfigured()) {
      setNotice({ kind: "error", text: "Configure Supabase to publish shared comments." });
      return;
    }
    if (!currentUser) {
      setAuthOpen(true);
      setNotice({ kind: "error", text: "Sign in to comment." });
      return;
    }
    const parsed = commentDraftSchema.safeParse({ body: text });
    if (!parsed.success) {
      setNotice({ kind: "error", text: parsed.error.issues.map((issue) => issue.message).join(" ") });
      return;
    }

    let comment: CommentItem;
    try {
        const response = await fetch(`/api/posts/${encodeURIComponent(postId)}/comments`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ body: parsed.data.body, parentId: parentId ?? null }),
        });
        const result: unknown = await response.json();
        if (!response.ok) {
          const message = typeof result === "object" && result !== null && "error" in result && typeof result.error === "string"
            ? result.error
            : "Could not publish your comment. Please try again.";
          throw new Error(message);
        }
        const parsedResult = commentResponseSchema.safeParse(result);
        if (!parsedResult.success) {
          throw new Error("The server returned an invalid comment response.");
        }
        comment = { ...parsedResult.data.comment, replies: [] };
    } catch (error) {
        setNotice({ kind: "error", text: error instanceof Error ? error.message : "Could not publish your comment." });
        return;
    }

    setPosts((current) =>
      current.map((post) => {
        if (post.id !== postId) return post;
        return {
          ...post,
          comments: parentId
            ? addReply(post.comments, parentId, comment)
            : [...post.comments, comment],
        };
      }),
    );
    setCommentDrafts((current) => ({ ...current, [postId]: "" }));
    setReplyDraft("");
    setReplyingTo(null);
    setNotice({ kind: "success", text: "Comment published." });
  }

  async function votePost(postId: string, selectedVote: -1 | 1) {
    const nextVote = votes[postId] === selectedVote ? 0 : selectedVote;
    if (!isSupabaseConfigured() || !currentUser) {
      if (!currentUser) setAuthOpen(true);
      setNotice({ kind: "error", text: "Configure Supabase and sign in to vote on posts." });
      return;
    }
    try {
      const response = await fetch(`/api/posts/${encodeURIComponent(postId)}/votes`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vote: nextVote }),
      });
      const result: unknown = await response.json();
      if (!response.ok) {
        const message = typeof result === "object" && result !== null && "error" in result && typeof result.error === "string"
          ? result.error
          : "Could not save your vote. Please try again.";
        throw new Error(message);
      }
      if (typeof result !== "object" || result === null || !("score" in result) || !("vote" in result)) {
        throw new Error("The server returned an invalid vote response.");
      }
      setPosts((current) => current.map((post) => post.id === postId
        ? { ...post, votes: Number(result.score) }
        : post));
      setVotes((current) => ({ ...current, [postId]: Number(result.vote) }));
    } catch (error) {
      setNotice({ kind: "error", text: error instanceof Error ? error.message : "Could not save your vote." });
    }
  }

  function submitComment(event: FormEvent<HTMLFormElement>, postId: string, text: string, parentId?: string) {
    event.preventDefault();
    const value = text.trim();
    if (!value) return;
    if (includesPersonalInfo(value)) {
      setPendingShare({ kind: "comment", text: value, postId, parentId });
      return;
    }
    addComment(postId, value, parentId);
  }

  function confirmShare() {
    if (!pendingShare) return;
    const share = pendingShare;
    setPendingShare(null);
    if (share.kind === "message") void sendMessage(share.text);
    if (share.kind === "comment" && share.postId) addComment(share.postId, share.text, share.parentId);
    if (share.kind === "post") {
      const [title, ...body] = share.text.split("\n");
      publishPost({ city: citySlug, title, body: body.join("\n"), tag: postTag });
    }
  }

  function renderComments(comments: CommentItem[], postId: string, depth = 0): ReactNode {
    return comments.filter((comment) => !comment.author_username || !blockedUsernames.has(comment.author_username)).map((comment) => (
      <div className="comment" key={comment.id} style={{ marginLeft: Math.min(depth, 3) * 16 }}>
        <div className="comment-line">
          <span className="avatar avatar-small">{initials(comment.author)}</span>
          <strong>{comment.author}</strong>
          <span>{comment.body}</span>
        </div>
        <div className="comment-actions">
          <button className="text-button" type="button" onClick={() => setReplyingTo(comment.id)}>Reply</button>
          <button className="text-button" type="button" onClick={() => openReport({
            type: "comment",
            id: comment.id,
            author: comment.author,
            authorUsername: comment.author_username,
            label: `comment by ${comment.author}`,
            targetContent: comment.body,
          })}>Report</button>
          {comment.author_username && (
            <button className="text-button" type="button" onClick={() => void updateBlock(
              comment.author_username!,
              !blockedUsernames.has(comment.author_username!),
            )}>
              {blockedUsernames.has(comment.author_username) ? "Unblock" : "Block"}
            </button>
          )}
        </div>
        {replyingTo === comment.id && (
          <form className="reply-form" onSubmit={(event) => submitComment(event, postId, replyDraft, comment.id)}>
            <label className="sr-only" htmlFor={`reply-${comment.id}`}>Reply to {comment.author}</label>
            <input
              id={`reply-${comment.id}`}
              value={replyDraft}
              onChange={(event) => setReplyDraft(event.target.value)}
              placeholder={`Reply to ${comment.author}`}
              maxLength={1000}
            />
            <button className="button button-small button-primary" type="submit">Reply</button>
          </form>
        )}
        {comment.replies.length > 0 && (
          <div className="nested-replies">{renderComments(comment.replies, postId, depth + 1)}</div>
        )}
      </div>
    ));
  }

  return (
    <>
    <div className={`app-shell ${mobileView === "chat" ? "mobile-chat-mode" : ""}`}>
      <aside className="sidebar" aria-label="VibeChat navigation">
        <SiteBrand />
        <div className="sidebar-label-row">
          <h2>Your cities</h2>
          <span className="subtle">Saved on this device</span>
        </div>
        <div className="search-wrap">
          <label className="sr-only" htmlFor="city-search">Search cities</label>
          <input
            id="city-search"
            className="search-input"
            value={citySearch}
            onChange={(event) => setCitySearch(event.target.value)}
            placeholder="Find a city"
            type="search"
          />
          {citySearch.trim() && (
            <button
              className="button button-small search-clear"
              type="button"
              onClick={() => setCitySearch("")}
              aria-label="Clear city search"
            >
              ×
            </button>
          )}
        </div>
        {citySearch.trim() && (
          <div className="city-results" role="list" aria-label="City search results">
            {cityMatches.length ? cityMatches.map((item) => (
              <div className="city-result" key={item.slug}>
                <span>{item.name}</span>
                {joined.includes(item.slug) ? (
                  <button className="text-button" type="button" onClick={() => selectCity(item.slug)}>Open</button>
                ) : (
                  <button className="button button-small button-primary" type="button" onClick={() => joinCity(item.slug)}>Join</button>
                )}
              </div>
            )) : <p className="subtle empty-search">No cities match that search.</p>}
          </div>
        )}
        <nav className="city-nav" aria-label="Joined cities">
          {joined
            .slice()
            .sort((a, b) => (a === "general" ? -1 : b === "general" ? 1 : 0))
            .map((slug) => {
              const item = CITIES.find((candidate) => candidate.slug === slug);
              if (!item) return null;
              return (
                <div className={`city-row ${citySlug === slug ? "city-row-active" : ""}`} key={slug}>
                  <button className="city-link" type="button" onClick={() => selectCity(slug)} aria-current={citySlug === slug ? "page" : undefined}>
                    <span className="city-dot" aria-hidden="true" />
                    <span className="city-name">{item.name}</span>
                    {slug === "general" && <span className="always-joined">Default</span>}
                  </button>
                  {slug !== "general" && (
                    <div className="city-tools">
                      <button
                        className={`icon-button favourite-button ${favourites.includes(slug) ? "is-favourite" : ""}`}
                        type="button"
                        aria-label={`${favourites.includes(slug) ? "Unfavourite" : "Favourite"} ${item.name}`}
                        title={`${favourites.includes(slug) ? "Unfavourite" : "Favourite"} ${item.name}`}
                        onClick={() => toggleFavourite(slug)}
                      >{favourites.includes(slug) ? "★" : "☆"}</button>
                      <button className="icon-button" type="button" aria-label={`Leave ${item.name}`} title={`Leave ${item.name}`} onClick={() => leaveCity(slug)}>×</button>
                    </div>
                  )}
                </div>
              );
            })}
        </nav>
        <div className="sidebar-bottom">
          {currentUser && profile ? (
            <>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                {profile.avatar_url ? (
                  <Image src={profile.avatar_url} alt="Avatar" width={28} height={28} unoptimized style={{ width: 28, height: 28, borderRadius: 50, objectFit: "cover", border: "1px solid #4b4c3f" }} />
                ) : (
                  <span style={{
                    width: 28, height: 28, borderRadius: 50, background: "#303126", color: "#e1c37f",
                    fontSize: 10, fontWeight: 700, display: "grid", placeItems: "center", flex: "none",
                    border: "1px solid #4b4c3f",
                  }}>{(profile.display_name || profile.username).split(/[_\s]+/).map((p: string) => p[0]).filter(Boolean).slice(0, 2).join("").toUpperCase() || "?"}</span>
                )}
                <div style={{ minWidth: 0 }}>
                  <strong style={{ display: "block", fontSize: 13, color: "#e7e5de" }}>{profile.display_name || profile.username}</strong>
                  {profile.tag && <span style={{ fontSize: 11, color: "#a0a699", background: "#22251f", border: "1px solid #343830", borderRadius: 4, padding: "0 6px" }}>{profile.tag}</span>}
                </div>
              </div>
            </>
          ) : (
            <p>{currentUser ? `Signed in as ${currentUser.email ?? "Google account"}.` : "Sign in with Google to publish posts shared with the community."}</p>
          )}
          {currentUser ? (
            <button className="button sign-in-button" type="button" onClick={() => void signOut()}>Sign out</button>
          ) : (
            <button className="button sign-in-button" type="button" onClick={() => setAuthOpen(true)}>Sign in</button>
          )}
          <div className="legal-links"><Link href="/privacy">Privacy</Link><Link href="/terms">Terms</Link></div>
        </div>
      </aside>

      <main ref={mainRef} className={`main-content ${mobileView === "chat" ? "mobile-chat-active" : ""}`}>
        <header className="topbar">
          <div className="breadcrumbs"><span>Community</span><span aria-hidden="true">/</span><strong>{city.name}</strong></div>
          <div className="topbar-actions">
            <div className="search-wrap">
              <label className="sr-only" htmlFor="post-search">Search posts in {city.name}</label>
              <input
                id="post-search"
                className="search-input post-search"
                value={postSearch}
                onChange={(event) => setPostSearch(event.target.value)}
                placeholder="Search this board"
                type="search"
              />
              {postSearch.trim() && (
                <button
                  className="button button-small search-clear"
                  type="button"
                  onClick={() => setPostSearch("")}
                  aria-label="Clear post search"
                >
                  ×
                </button>
              )}
            </div>
            <button className="button safety-center-button" type="button" onClick={() => setSafetyCenterOpen(true)}>
              Safety{ safetyReports.filter((report) => report.status === "open").length > 0
                ? ` · ${safetyReports.filter((report) => report.status === "open").length}`
                : ""}
            </button>
            <button className="button sign-in-mobile" type="button" onClick={() => setAuthOpen(true)}>
              {currentUser ? "Account" : "Sign in"}
            </button>
          </div>
        </header>

        <nav className="mobile-view-switch" aria-label="Community sections">
          <button
            className={mobileView === "board" ? "mobile-view-active" : ""}
            type="button"
            aria-pressed={mobileView === "board"}
            onClick={() => showMobileView("board")}
          >Board</button>
          <button
            className={mobileView === "chat" ? "mobile-view-active" : ""}
            type="button"
            aria-pressed={mobileView === "chat"}
            onClick={() => showMobileView("chat")}
          >Chat</button>
        </nav>

        <div className="board-layout">
          <section className="feed-column" aria-labelledby="board-title">
            <div className="board-heading">
              <div>
                <p className="eyebrow">{city.slug === "general" ? "Open community" : `${city.region} community`}</p>
                <h1 id="board-title">{city.name}</h1>
                <p className="board-description">
                  {city.slug === "general"
                    ? "Meet people, plan a meetup, solve a problem, or ask the community for help."
                    : `Local posts and conversation for people in ${city.name}.`}
                </p>
              </div>
              <button className="button button-primary" type="button" onClick={() => setNewPostOpen((open) => !open)}>
                {newPostOpen ? "Close" : "Write a post"}
              </button>
            </div>

            {notice && (
              <div className={`notice notice-${notice.kind}`} role={notice.kind === "error" ? "alert" : "status"}>
                <span>{notice.text}</span>
                <button className="text-button" type="button" onClick={() => setNotice(null)} aria-label="Dismiss message">Dismiss</button>
              </div>
            )}

            {newPostOpen && (
              <form className="composer card" onSubmit={submitPost}>
                <div className="composer-heading">
                  <span className="avatar">YO</span>
                  <div><strong>Start a conversation</strong><span className="subtle">Posting to {city.name}</span></div>
                </div>
                <label className="sr-only" htmlFor="post-title">Post title</label>
                <input id="post-title" value={postTitle} onChange={(event) => setPostTitle(event.target.value)} placeholder="A clear, specific title" maxLength={140} required />
                <label className="sr-only" htmlFor="post-body">Post details</label>
                <textarea id="post-body" value={postBody} onChange={(event) => setPostBody(event.target.value)} placeholder="Add useful context. Avoid sharing private contact details." maxLength={4000} rows={4} required />
                <div className="image-attachments">
                  <label className="button button-small" htmlFor="post-images">Add images ({postImages.length}/4)</label>
                  <input
                    className="image-file-input"
                    id="post-images"
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    multiple
                    onChange={(event) => {
                      void attachImages(event.currentTarget.files, "post");
                      event.currentTarget.value = "";
                    }}
                  />
                  <span className="subtle">JPEG, PNG or WebP · up to 5 MB each · compressed to WebP, max 1600 px / 1.5 MB</span>
                </div>
                {postImages.length > 0 && (
                  <div className="image-attachments-preview" aria-label="Selected post images">
                    {postImages.map((image) => (
                      <figure key={image.url}>
                        <Image src={image.url} alt={image.name} width={image.width} height={image.height} unoptimized />
                        <figcaption>{image.width}×{image.height} · {(image.size / (1024 * 1024)).toFixed(2)} MB</figcaption>
                        <button className="text-button" type="button" onClick={() => removeLocalImage(image)}>Remove</button>
                      </figure>
                    ))}
                  </div>
                )}
                <div className="composer-footer">
                  <label className="sr-only" htmlFor="post-tag">Post topic</label>
                  <select id="post-tag" value={postTag} onChange={(event) => {
                    const parsedTag = postTagSchema.safeParse(event.target.value);
                    if (parsedTag.success) setPostTag(parsedTag.data);
                  }}>
                    {POST_TAGS.map((tag) => <option key={tag}>{tag}</option>)}
                  </select>
                  <button className="button button-primary" type="submit">Publish post</button>
                </div>
              </form>
            )}

            <div className="feed-toolbar">
              <h2>Latest posts</h2>
              <span className="subtle">{isSupabaseConfigured() ? "Community posts" : "Connect Supabase to load community posts"}</span>
            </div>

            {postsError ? (
              <div className="empty-state card" role="alert">
                <h2>Posts could not be loaded</h2>
                <p>{postsError}</p>
                <button className="button" type="button" onClick={() => setPostsRefresh((value) => value + 1)}>Try again</button>
              </div>
            ) : loading ? (
              <div className="card loading-card" role="status" aria-label="Loading posts">
                <span className="skeleton skeleton-short" /><span className="skeleton" /><span className="skeleton skeleton-long" />
                <span className="skeleton skeleton-short" /><span className="skeleton" />
              </div>
            ) : visiblePosts.length === 0 ? (
              <div className="empty-state card">
                <span className="empty-mark" aria-hidden="true">+</span>
                <h2>{postSearch ? "No matching posts" : "No posts here yet"}</h2>
                <p>{postSearch ? "Try a different word or clear your search." : "Start the board with a question or a useful local tip."}</p>
                {!postSearch && <button className="button button-primary" type="button" onClick={() => setNewPostOpen(true)}>Write the first post</button>}
              </div>
            ) : (
              <div className="post-list">
                {visiblePosts.map((post) => {
                  const expanded = expandedPosts.includes(post.id);
                  const score = post.votes + (isSupabaseConfigured() ? 0 : votes[post.id] ?? 0);
                  return (
                    <article className="card post-card" key={post.id}>
                      <div className="post-meta">
                        {post.avatar_url ? (
                          <Image className="avatar" src={post.avatar_url} alt="Avatar" width={34} height={34} unoptimized />
                        ) : (
                          <span className="avatar">{post.initials}</span>
                        )}
                        <div className="author-line"><strong>{post.author}</strong><span>{post.time}</span></div>
                        <span className="tag">{post.tag}</span>
                        <details className="post-menu">
                          <summary aria-label={`More actions for ${post.title}`}>•••</summary>
                          <div className="menu-panel">
                            <button type="button" onClick={() => openReport({
                              type: "post",
                              id: post.id,
                              author: post.author,
                              authorUsername: post.author_username,
                              label: `post by ${post.author}`,
                              targetContent: `${post.title}\n${post.body}`,
                            })}>Report post</button>
                              {!post.mine && post.author_username && <button type="button" onClick={() => void updateBlock(
                                post.author_username!,
                                !blockedUsernames.has(post.author_username!),
                              )}>
                                {blockedUsernames.has(post.author_username) ? "Unblock author" : "Block author"}
                              </button>}
                            {post.mine && <button type="button" onClick={() => void deletePost(post)}>Delete post</button>}
                          </div>
                        </details>
                      </div>
                      {editingPost === post.id ? (
                        <form className="edit-form" onSubmit={(event) => savePostEdit(event, post.id)}>
                          <label className="sr-only" htmlFor={`edit-title-${post.id}`}>Edit post title</label>
                          <input id={`edit-title-${post.id}`} value={editTitleDraft} onChange={(event) => setEditTitleDraft(event.target.value)} maxLength={140} required />
                          <textarea value={editDraft} onChange={(event) => setEditDraft(event.target.value)} rows={3} required />
                          <button className="button button-small button-primary" type="submit">Save edit</button>
                          <button className="text-button" type="button" onClick={() => setEditingPost(null)}>Cancel</button>
                        </form>
                      ) : (
                        <div className="post-content">
                          <h3>{post.title}</h3>
                          <p>{post.body}</p>
                          {post.images && post.images.length > 0 && (
                            <div className="image-gallery">
                              {post.images.map((image) => (
                                <Image key={image.url} src={image.url} alt={image.name} width={image.width} height={image.height} unoptimized />
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                      <div className="post-actions">
                        <div className="vote-control" aria-label={`Vote score ${score}`}>
                          <button className="icon-button" type="button" aria-label="Upvote post" aria-pressed={votes[post.id] === 1} onClick={() => void votePost(post.id, 1)}>↑</button>
                          <span>{score}</span>
                          <button className="icon-button" type="button" aria-label="Downvote post" aria-pressed={votes[post.id] === -1} onClick={() => void votePost(post.id, -1)}>↓</button>
                        </div>
                        <button className="text-button" type="button" onClick={() => setExpandedPosts((current) => current.includes(post.id) ? current.filter((id) => id !== post.id) : [...current, post.id])}>
                          {expanded ? "Hide replies" : `${post.comments.length} comments`}
                        </button>
                        {post.mine && <button className="text-button" type="button" onClick={() => { setEditingPost(post.id); setEditTitleDraft(post.title); setEditDraft(post.body); }}>Edit</button>}
                      </div>
                      {expanded && (
                        <div className="comments">
                          {post.comments.length ? renderComments(post.comments, post.id) : <p className="subtle">No replies yet. Add a helpful response.</p>}
                          <form className="reply-form" onSubmit={(event) => submitComment(event, post.id, commentDrafts[post.id] ?? "")}>
                            <label className="sr-only" htmlFor={`comment-${post.id}`}>Write a comment</label>
                            <input id={`comment-${post.id}`} value={commentDrafts[post.id] ?? ""} onChange={(event) => setCommentDrafts((current) => ({ ...current, [post.id]: event.target.value }))} placeholder="Write a reply" maxLength={1000} />
                            <button className="button button-small button-primary" type="submit">Reply</button>
                          </form>
                        </div>
                      )}
                    </article>
                  );
                })}
              </div>
            )}
            <footer className="page-footer"><span>VibeChat · Community posts and chat</span><span><Link href="/privacy">Privacy</Link><Link href="/terms">Terms</Link></span></footer>
          </section>

          <section className="chat-panel" aria-label={`${city.name} chat`}>
            <header className="mobile-chat-heading">
              <h1>{city.slug === "general" ? "General Chat" : `${city.name} Chat`}</h1>
              <button
                className="chat-chaat-button"
                type="button"
                aria-pressed={channelId === primaryChannel.id}
                onClick={() => setChannelId(primaryChannel.id)}
              >
                Chat-Chaat
              </button>
            </header>

            <div className="chat-heading desktop-chat-heading">
              <div><p className="eyebrow">Community chat</p><h2>{city.name}</h2></div>
              <span className="demo-status"><span />{isSupabaseConfigured() ? "Shared messages" : "Supabase setup required"}</span>
            </div>
            <div className="channel-list" role="tablist" aria-label="Chat channels">
              {channels.map((channel) => (
                <button
                  className={`channel-button ${channelId === channel.id ? "channel-active" : ""}`}
                  key={channel.id}
                  type="button"
                  role="tab"
                  aria-selected={channelId === channel.id}
                  onClick={() => setChannelId(channel.id)}
                >
                  <span aria-hidden="true">#</span>{channel.label}
                </button>
              ))}
            </div>
            <nav className={`mobile-chat-rail mobile-chat-rail-left ${leftRailOpen ? "rail-expanded" : ""}`} aria-label="City navigation">
              <button
                className="rail-toggle"
                type="button"
                aria-label={`${leftRailOpen ? "Collapse" : "Expand"} city sidebar`}
                aria-expanded={leftRailOpen}
                onClick={() => setLeftRailOpen((open) => !open)}
              >{leftRailOpen ? "‹" : "›"}</button>
              {leftRailOpen && (
                <div className="rail-items">
                  {joined.map((slug) => {
                    const item = CITIES.find((candidate) => candidate.slug === slug);
                    if (!item) return null;
                    return (
                      <button
                        className={`rail-item ${citySlug === slug ? "rail-item-active" : ""}`}
                        key={slug}
                        type="button"
                        aria-label={`Open ${item.name} chat`}
                        onClick={() => { selectCity(slug); setLeftRailOpen(false); }}
                      >{initials(item.name)}</button>
                    );
                  })}
                </div>
              )}
            </nav>

            <nav className={`mobile-chat-rail mobile-chat-rail-right ${rightRailOpen ? "rail-expanded" : ""}`} aria-label="Chat channels">
              <button
                className="rail-toggle"
                type="button"
                aria-label={`${rightRailOpen ? "Collapse" : "Expand"} channel sidebar`}
                aria-expanded={rightRailOpen}
                onClick={() => setRightRailOpen((open) => !open)}
              >{rightRailOpen ? "›" : "‹"}</button>
              {rightRailOpen && (
                <div className="rail-items">
                  {channels.map((channel) => (
                    <button
                      className={`rail-item ${channelId === channel.id ? "rail-item-active" : ""}`}
                      key={channel.id}
                      type="button"
                      aria-label={`Open ${channel.label} channel`}
                      aria-pressed={channelId === channel.id}
                      onClick={() => { setChannelId(channel.id); setRightRailOpen(false); }}
                    >#</button>
                  ))}
                </div>
              )}
            </nav>

            <div className="chat-log" ref={chatLogRef} role="log" aria-live="polite" aria-relevant="additions text" aria-label="Conversation">
              {chatLoading && currentMessages.length === 0 ? (
                <div className="chat-loading" role="status">Loading conversation…</div>
              ) : chatLoadError && currentMessages.length === 0 ? (
                <div className="chat-empty" role="alert">
                  <h3>Chat is unavailable</h3>
                  <p>{chatLoadError}</p>
                </div>
              ) : currentMessages.length === 0 ? (
                <div className="chat-empty">
                  <h3>No messages yet</h3>
                  <p>Start a conversation in {channels.find((channel) => channel.id === channelId)?.label}.</p>
                </div>
              ) : currentMessages.map((message) => (
                <article className={`chat-message ${message.fromYou ? "chat-message-own" : ""}`} key={message.id}>
                  {!message.fromYou && <span className="avatar avatar-small">{message.initials}</span>}
                  <div className="message-content">
                    <div className="message-meta"><strong>{message.fromYou ? "You" : message.author}</strong><time>{message.time}</time></div>
                    {message.body && <p>{message.body}</p>}
                  </div>
                  {message.fromYou && <span className="avatar avatar-small">{message.initials}</span>}
                </article>
              ))}
            </div>
            <form className="chat-form" onSubmit={submitMessage}>
              <label className="sr-only" htmlFor="chat-message">Message Chat-Chaat</label>
              <textarea id="chat-message" value={chatDraft} onKeyDown={handleComposerKeyDown} onChange={(event) => setChatDraft(event.target.value)} placeholder="Message Chat-Chaat…" maxLength={2000} rows={2} enterKeyHint="send" />
              {chatError && <p className="chat-error" role="alert">{chatError}</p>}
              <div className="chat-form-footer">
                <span className="subtle">Shared with this channel · Enter to send · Shift+Enter for a new line</span>
                <button className="button button-primary button-small" type="submit" disabled={chatCooldown || !chatDraft.trim()}>{chatCooldown ? "Wait 3s…" : "Send"}</button>
              </div>
            </form>
          </section>
        </div>
      </main>

      {authOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setAuthOpen(false); }}>
          <section className="modal" role="dialog" aria-modal="true" aria-labelledby="auth-title">
            <button className="modal-close" type="button" onClick={() => setAuthOpen(false)} aria-label="Close sign-in dialog">×</button>
            <p className="eyebrow">Account</p>
            <h2 id="auth-title">{currentUser ? "Your account" : "Sign in with Google"}</h2>
            <p>{currentUser
              ? `You are signed in as ${currentUser.email ?? "your Google account"}.`
              : "Google sign-in is used to publish and manage your community posts. VibeChat does not receive your Google password."}</p>
            {!currentUser && (
              <button className="button button-primary" type="button" onClick={() => void signInWithGoogle()} disabled={authLoading}>
                {authLoading ? "Redirecting to Google…" : "Continue with Google"}
              </button>
            )}
            {authError && <p className="chat-error" role="alert">{authError}</p>}
            {currentUser && <Link className="button" href="/profile">Edit your profile and avatar</Link>}
            <p>Access requires confirming that you are 18 or older at the entry gate.</p>
            <div className="modal-actions">
              {currentUser && <button className="button" type="button" onClick={() => void signOut()}>Sign out</button>}
              <button className="button" type="button" onClick={() => setAuthOpen(false)}>Close</button>
            </div>
          </section>
        </div>
      )}

      {reportTarget && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setReportTarget(null); }}>
          <form className="modal" role="dialog" aria-modal="true" aria-labelledby="report-title" onSubmit={submitReport}>
            <button className="modal-close" type="button" onClick={() => setReportTarget(null)} aria-label="Close report dialog">×</button>
            <p className="eyebrow">Community safety</p><h2 id="report-title">Report {reportTarget.label}</h2>
            <p>Reports are shared with authorized community safety moderators.</p>
            <label htmlFor="report-reason">Reason</label>
            <select id="report-reason" value={reportReason} onChange={(event) => setReportReason(event.target.value)} required>
              <option value="">Choose a reason</option>
              <option value="harassment">Harassment or bullying</option>
              <option value="hate">Hateful or discriminatory content</option>
              <option value="spam">Spam or scam</option>
              <option value="personal-information">Personal information</option>
              <option value="violence">Threats or violence</option>
              <option value="other">Something else</option>
            </select>
            <label htmlFor="report-details">Additional details (optional)</label>
            <textarea id="report-details" value={reportDetails} onChange={(event) => setReportDetails(event.target.value)} maxLength={500} placeholder="Share only what helps explain the concern." rows={3} />
            <div className="modal-actions">
              {reportTarget.authorUsername && (
                <button
                  className="button"
                  type="button"
                  onClick={() => {
                    void updateBlock(reportTarget.authorUsername!, !blockedUsernames.has(reportTarget.authorUsername!));
                    setReportTarget(null);
                  }}
                >
                  {blockedUsernames.has(reportTarget.authorUsername) ? "Unblock author" : "Block author"}
                </button>
              )}
              <button className="button button-primary" type="submit" disabled={!reportReason}>Submit report</button>
            </div>
          </form>
        </div>
      )}

      {safetyCenterOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSafetyCenterOpen(false); }}>
          <section className="modal safety-modal" role="dialog" aria-modal="true" aria-labelledby="safety-title">
            <button className="modal-close" type="button" onClick={() => setSafetyCenterOpen(false)} aria-label="Close safety center">×</button>
            <p className="eyebrow">Community safety</p>
            <h2 id="safety-title">Safety center</h2>
            <p>{moderatorView
              ? "Moderator queue. Only accounts with the trusted moderator role can review and update reports."
              : "Your reports are saved privately to your account for review by community safety moderators."}</p>
            <section className="safety-section" aria-labelledby="reports-heading">
              <h3 id="reports-heading">{moderatorView ? "Moderation queue" : "Your reports"} ({safetyReports.length})</h3>
              {safetyReports.length === 0 ? (
                <p className="subtle">You have not submitted a report.</p>
              ) : (
                <div className="safety-list">
                  {safetyReports.map((report) => (
                    <article className="safety-item" key={report.reportId}>
                      <div>
                        <strong>{report.label}</strong>
                        <span>{report.reason.replaceAll("-", " ")} · {report.status}</span>
                        {report.targetContent && <p>{report.targetContent}</p>}
                        {report.details && <p>{report.details}</p>}
                      </div>
                      {moderatorView && report.status !== "actioned" && (
                        <div className="safety-actions">
                          {report.status === "open" && (
                            <button className="button button-small" type="button" onClick={() => void moderateReport(report.reportId, "reviewed")}>
                              Mark reviewed
                            </button>
                          )}
                          <button className="button button-small button-danger" type="button" onClick={() => void moderateReport(report.reportId, "actioned")}>
                            Mark actioned
                          </button>
                        </div>
                      )}
                    </article>
                  ))}
                </div>
              )}
            </section>
            {!moderatorView && (
              <section className="safety-section" aria-labelledby="blocked-heading">
                <h3 id="blocked-heading">Blocked accounts ({blockedAuthors.length})</h3>
                {blockedAuthors.length === 0 ? <p className="subtle">You have not blocked anyone.</p> : (
                  <div className="safety-list">
                    {blockedAuthors.map((account) => (
                      <div className="safety-item" key={account.username}>
                        <strong>{account.name}</strong>
                        <button className="button button-small" type="button" onClick={() => void updateBlock(account.username, false)}>Unblock</button>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            )}
            <button className="button button-primary" type="button" onClick={() => setSafetyCenterOpen(false)}>Done</button>
          </section>
        </div>
      )}

    </div>

      {pendingShare && (
        <div className="modal-backdrop" role="presentation">
          <section className="modal" role="alertdialog" aria-modal="true" aria-labelledby="privacy-warning-title">
            <p className="eyebrow">Privacy check</p><h2 id="privacy-warning-title">This may include personal information</h2>
            <p>Your message looks like it may contain a phone number or address. Public posts and chat can be visible to other people. Review it before sharing.</p>
            <div className="modal-actions">
              <button className="button" type="button" onClick={() => setPendingShare(null)}>Review message</button>
              <button className="button button-primary" type="button" onClick={confirmShare}>Share anyway</button>
            </div>
          </section>
        </div>
      )}

    </>
  );
}
