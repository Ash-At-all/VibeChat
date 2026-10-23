"use client";

import Link from "next/link";
import Image from "next/image";
import { FormEvent, KeyboardEvent, ReactNode, TouchEvent, useEffect, useMemo, useRef, useState } from "react";
import { SiteBrand } from "@/components/site-brand";
import { CITIES } from "@/lib/cities";
import {
  commentDraftSchema,
  messageDraftSchema,
  POST_TAGS,
  postDraftSchema,
  postEditSchema,
  postTagSchema,
  postValidationRequestSchema,
  type PostTag,
} from "@/lib/post-schema";
import { processImage, type ImagePurpose } from "@/lib/client-image";

type LocalImage = { url: string; name: string; size: number; width: number; height: number };
type CommentItem = {
  id: string;
  author: string;
  body: string;
  replies: CommentItem[];
};
type Post = {
  id: string;
  city: string;
  author: string;
  initials: string;
  time: string;
  tag: string;
  title: string;
  body: string;
  images?: LocalImage[];
  votes: number;
  comments: CommentItem[];
  mine?: boolean;
};
type Message = { id: string; body: string; time: string; fromYou: boolean; image?: LocalImage };
type Channel = { id: string; label: string };
type Story = { id: string; name: string; initials: string; city: string; text: string };
type Friend = { id: string; name: string; initials: string; online: boolean };
type SafetyTarget = { type: "post" | "comment"; id: string; author: string; label: string };
type SafetyReport = SafetyTarget & {
  reportId: string;
  reason: string;
  details: string;
  status: "open" | "dismissed" | "banned";
};
type PendingShare = {
  kind: "post" | "message" | "comment";
  text: string;
  postId?: string;
  parentId?: string;
  image?: LocalImage;
};

const GENERAL_CHANNELS: Channel[] = [
  { id: "chitchat", label: "Chit-chat" },
  { id: "meetings", label: "Meetings" },
  { id: "problems", label: "Problem-solving" },
  { id: "help", label: "Help" },
];
const CITY_CHANNELS: Channel[] = [{ id: "city-chat", label: "City chat" }];
const DEMO_FRIENDS: Friend[] = [
  { id: "mira", name: "Mira K.", initials: "MK", online: true },
  { id: "rohan", name: "Rohan", initials: "RO", online: true },
  { id: "anya", name: "Anya", initials: "AN", online: false },
  { id: "dev", name: "Dev S.", initials: "DS", online: true },
  { id: "isha", name: "Isha", initials: "IS", online: false },
];
const DEMO_STORIES: Story[] = [
  { id: "mira", name: "Mira K.", initials: "MK", city: "Pune", text: "Found a quiet breakfast spot near Deccan. Sharing local picks with the community." },
  { id: "rohan", name: "Rohan", initials: "RO", city: "Pune", text: "Planning a relaxed weekend meetup. What should we try next?" },
  { id: "anya", name: "Anya", initials: "AN", city: "Mumbai", text: "A few small cafes around the neighbourhood are worth a visit." },
  { id: "dev", name: "Dev S.", initials: "DS", city: "Pune", text: "Moving soon? I put together a checklist for finding a flat." },
  { id: "isha", name: "Isha", initials: "IS", city: "Bengaluru", text: "Looking for people to explore local markets this weekend." },
];

const INITIAL_POSTS: Post[] = [
  {
    id: "pune-market",
    city: "pune",
    author: "Mira K.",
    initials: "MK",
    time: "Demo post",
    tag: "Food",
    title: "Good places for breakfast near Deccan?",
    body: "Looking for a quiet spot with good coffee and breakfast. Local recommendations are welcome.",
    votes: 8,
    comments: [
      {
        id: "pune-market-c1",
        author: "Rohan",
        body: "Vaishali is a classic, especially if you get there early.",
        replies: [
          {
            id: "pune-market-c1-r1",
            author: "Mira K.",
            body: "Thanks, I will try it this weekend.",
            replies: [],
          },
        ],
      },
      {
        id: "pune-market-c2",
        author: "Anya",
        body: "There are a few smaller cafes on Apte Road too.",
        replies: [],
      },
    ],
  },
  {
    id: "pune-rent",
    city: "pune",
    author: "Dev S.",
    initials: "DS",
    time: "Demo post",
    tag: "Rent",
    title: "What should I check before renting a flat?",
    body: "Moving to Pune next month. What questions should I ask a landlord before signing?",
    votes: 5,
    comments: [],
  },
  {
    id: "general-welcome",
    city: "general",
    author: "VibeChat team",
    initials: "VC",
    time: "Demo post",
    tag: "Welcome",
    title: "Welcome to General Chat",
    body: "Use the channels to meet people, plan a meetup, work through a problem, or ask the community for help. Please keep personal details private.",
    votes: 3,
    comments: [],
  },
];

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

function makeId(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}`;
}

export default function Home() {
  const [joined, setJoined] = useState<string[]>(["general"]);
  const [favourites, setFavourites] = useState<string[]>([]);
  const [citySlug, setCitySlug] = useState("general");
  const [channelId, setChannelId] = useState("chitchat");
  const [mobileView, setMobileView] = useState<"board" | "chat">("chat");
  const [citySearch, setCitySearch] = useState("");
  const [postSearch, setPostSearch] = useState("");
  const [posts, setPosts] = useState<Post[]>(INITIAL_POSTS);
  const [postImages, setPostImages] = useState<LocalImage[]>([]);
  const [chatImage, setChatImage] = useState<LocalImage | null>(null);
  const [avatarImage, setAvatarImage] = useState<LocalImage | null>(null);
  const [messages, setMessages] = useState<Record<string, Message[]>>({});
  const [loading, setLoading] = useState(true);
  const [newPostOpen, setNewPostOpen] = useState(false);
  const [postTitle, setPostTitle] = useState("");
  const [postBody, setPostBody] = useState("");
  const [postTag, setPostTag] = useState<PostTag>("General");
  const [chatDraft, setChatDraft] = useState("");
  const [commentDrafts, setCommentDrafts] = useState<Record<string, string>>({});
  const [replyDraft, setReplyDraft] = useState("");
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [expandedPosts, setExpandedPosts] = useState<string[]>([]);
  const [votes, setVotes] = useState<Record<string, number>>({});
  const [editingPost, setEditingPost] = useState<string | null>(null);
  const [editTitleDraft, setEditTitleDraft] = useState("");
  const [editDraft, setEditDraft] = useState("");
  const [blockedAuthors, setBlockedAuthors] = useState<string[]>([]);
  const [bannedAuthors, setBannedAuthors] = useState<string[]>([]);
  const [safetyReports, setSafetyReports] = useState<SafetyReport[]>([]);
  const [reportTarget, setReportTarget] = useState<SafetyTarget | null>(null);
  const [reportReason, setReportReason] = useState("");
  const [reportDetails, setReportDetails] = useState("");
  const [safetyCenterOpen, setSafetyCenterOpen] = useState(false);
  const [ageGateOpen, setAgeGateOpen] = useState(true);
  const [ageGateChecked, setAgeGateChecked] = useState(false);
  const [ageGateDenied, setAgeGateDenied] = useState(false);
  const [pendingShare, setPendingShare] = useState<PendingShare | null>(null);
  const [notice, setNotice] = useState<{ kind: "error" | "success"; text: string } | null>(null);
  const [authOpen, setAuthOpen] = useState(false);
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const [activeStory, setActiveStory] = useState<Story | null>(null);
  const [activeFriendId, setActiveFriendId] = useState<string | null>(null);
  const [leftRailOpen, setLeftRailOpen] = useState(false);
  const [rightRailOpen, setRightRailOpen] = useState(false);
  const [voiceChatOpen, setVoiceChatOpen] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const mainRef = useRef<HTMLElement>(null);
  const chatLogRef = useRef<HTMLDivElement>(null);
  const friendTouchStartY = useRef<number | null>(null);
  const imageUrls = useRef(new Set<string>());

  useEffect(() => () => {
    for (const url of imageUrls.current) URL.revokeObjectURL(url);
    imageUrls.current.clear();
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => setLoading(false), 300);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        if (localStorage.getItem("vibechat-18plus-confirmed") === "true") {
          setAgeGateOpen(false);
        }
        const storedJoined: unknown = JSON.parse(localStorage.getItem("vibechat-joined-cities") ?? "[]");
        const storedFavourites: unknown = JSON.parse(localStorage.getItem("vibechat-favourites") ?? "[]");
        const storedBlocked: unknown = JSON.parse(localStorage.getItem("vibechat-blocked-authors") ?? "[]");
        const storedBanned: unknown = JSON.parse(localStorage.getItem("vibechat-banned-authors") ?? "[]");
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
        if (Array.isArray(storedBlocked)) {
          setBlockedAuthors(storedBlocked.filter((author): author is string => typeof author === "string"));
        }
        if (Array.isArray(storedBanned)) {
          setBannedAuthors(storedBanned.filter((author): author is string => typeof author === "string"));
        }
      } catch {
        setNotice({ kind: "error", text: "Could not load saved age or safety preferences. Check this browser's storage settings." });
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

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
        return matchesCity && matchesSearch && !blockedAuthors.includes(post.author) && !bannedAuthors.includes(post.author);
      }),
    [bannedAuthors, blockedAuthors, citySlug, postSearch, posts],
  );
  const cityMatches = CITIES.filter((item) =>
    `${item.name} ${item.region}`.toLocaleLowerCase().includes(citySearch.trim().toLocaleLowerCase()),
  ).sort((a, b) => a.name.localeCompare(b.name));
  const currentMessages = useMemo(
    () => messages[`${citySlug}:${channelId}`] ?? [],
    [channelId, citySlug, messages],
  );
  const activeFriend = DEMO_FRIENDS.find((friend) => friend.id === activeFriendId);

  function confirmAgeGate(confirmed = ageGateChecked) {
    if (!confirmed) return;
    setAgeGateChecked(true);
    setAgeGateOpen(false);
    setAgeGateDenied(false);
    try {
      localStorage.setItem("vibechat-18plus-confirmed", "true");
    } catch {
      setNotice({ kind: "error", text: "You can continue, but this browser could not save your 18+ confirmation. You may be asked again next time." });
    }
  }

  function blockAuthor(author: string) {
    const nextBlocked = [...new Set([...blockedAuthors, author])];
    setBlockedAuthors(nextBlocked);
    try {
      localStorage.setItem("vibechat-blocked-authors", JSON.stringify(nextBlocked));
      setNotice({ kind: "success", text: `${author} is blocked in this browser preview. Their posts are hidden from you.` });
    } catch {
      setNotice({ kind: "error", text: "The block could not be saved in this browser." });
    }
  }

  function unblockAuthor(author: string) {
    const nextBlocked = blockedAuthors.filter((item) => item !== author);
    setBlockedAuthors(nextBlocked);
    try {
      localStorage.setItem("vibechat-blocked-authors", JSON.stringify(nextBlocked));
      setNotice({ kind: "success", text: `${author} has been unblocked in this browser preview.` });
    } catch {
      setNotice({ kind: "error", text: "The unblock could not be saved in this browser." });
    }
  }

  function banAuthor(author: string, reportId: string) {
    const nextBanned = [...new Set([...bannedAuthors, author])];
    setBannedAuthors(nextBanned);
    setSafetyReports((current) => current.map((report) =>
      report.reportId === reportId ? { ...report, status: "banned" } : report,
    ));
    try {
      localStorage.setItem("vibechat-banned-authors", JSON.stringify(nextBanned));
      setNotice({ kind: "success", text: `${author} was banned in this local moderator preview only.` });
    } catch {
      setNotice({ kind: "error", text: "The local preview ban could not be saved in this browser." });
    }
  }

  function liftBan(author: string) {
    const nextBanned = bannedAuthors.filter((item) => item !== author);
    setBannedAuthors(nextBanned);
    try {
      localStorage.setItem("vibechat-banned-authors", JSON.stringify(nextBanned));
      setSafetyReports((current) => current.map((report) =>
        report.author === author && report.status === "banned"
          ? { ...report, status: "open" }
          : report,
      ));
      setNotice({ kind: "success", text: `The local preview ban for ${author} was lifted.` });
    } catch {
      setNotice({ kind: "error", text: "The preview ban could not be lifted in this browser." });
    }
  }

  function openReport(target: SafetyTarget) {
    setReportTarget(target);
    setReportReason("");
    setReportDetails("");
  }

  function submitReport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!reportTarget || !reportReason) return;
    const report: SafetyReport = {
      ...reportTarget,
      reportId: makeId("report"),
      reason: reportReason,
      details: reportDetails.trim(),
      status: "open",
    };
    setSafetyReports((current) => [report, ...current]);
    setReportTarget(null);
    setSafetyCenterOpen(true);
    setNotice({ kind: "success", text: "Report added to this browser's demo moderation queue. It was not sent to a moderator." });
  }

  function dismissReport(reportId: string) {
    setSafetyReports((current) => current.map((report) =>
      report.reportId === reportId ? { ...report, status: "dismissed" } : report,
    ));
  }

  useEffect(() => {
    const log = chatLogRef.current;
    if (log && currentMessages.length > 0) {
      log.scrollTo({ top: log.scrollHeight, behavior: "smooth" });
    }
  }, [currentMessages]);

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

  async function validatePostOnServer(input: unknown) {
    const requestData = postValidationRequestSchema.safeParse(input);
    if (!requestData.success) {
      return requestData.error.issues.map((issue) => issue.message).join(" ");
    }
    return validateOnServer("/api/posts/validate", requestData.data, "post");
  }

  async function publishPost(input: unknown) {
    const parsed = postDraftSchema.safeParse(input);
    if (!parsed.success) {
      setNotice({ kind: "error", text: parsed.error.issues.map((issue) => issue.message).join(" ") });
      return;
    }

    const validationError = await validatePostOnServer({ operation: "create", post: parsed.data });
    if (validationError) {
      setNotice({ kind: "error", text: validationError });
      return;
    }

    setPosts((current) => [
      {
        id: makeId("post"),
        city: parsed.data.city,
        author: "You",
        initials: "YO",
        time: "Just now",
        tag: parsed.data.tag,
        title: parsed.data.title,
        body: parsed.data.body,
        images: postImages,
        votes: 0,
        comments: [],
        mine: true,
      },
      ...current,
    ]);
    setPostTitle("");
    setPostBody("");
    setPostImages([]);
    setNewPostOpen(false);
    setNotice({ kind: "success", text: "Post added in this demo. It is not shared with other people." });
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

    const validationError = await validatePostOnServer({ operation: "edit", post: parsed.data });
    if (validationError) {
      setNotice({ kind: "error", text: validationError });
      return;
    }

    setPosts((current) => current.map((post) =>
      post.id === postId
        ? { ...post, title: parsed.data.title, body: parsed.data.body }
        : post,
    ));
    setEditingPost(null);
    setNotice({ kind: "success", text: "Post updated in this demo." });
  }

  async function sendMessage(text: string, image = chatImage) {
    const body = text || (image ? "Image" : "");
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
      const key = `${citySlug}:${channelId}`;
      setMessages((current) => ({
        ...current,
        [key]: [...(current[key] ?? []), { id: makeId("message"), body: image && !text ? "" : parsed.data.body, time: "Just now", fromYou: true, image: image ?? undefined }],
      }));
      setChatDraft("");
      setChatImage(null);
      setChatError(null);
      setNotice({ kind: "success", text: "Message added in this demo. It is not shared with other people." });
    } catch {
      setChatError("Your message could not be added to this preview. Please try again.");
    }
  }

  function submitMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = chatDraft.trim();
    if (!text && !chatImage) return;
    if (includesPersonalInfo(text)) {
      setPendingShare({ kind: "message", text, image: chatImage ?? undefined });
      return;
    }
    sendMessage(text);
  }

  async function attachImages(files: FileList | null, purpose: Exclude<ImagePurpose, "avatar">) {
    if (!files?.length) return;
    const selectedFiles = Array.from(files);
    if (purpose === "post" && postImages.length + selectedFiles.length > 4) {
      setNotice({ kind: "error", text: "A post can include up to 4 images." });
      return;
    }
    if (purpose === "chat" && selectedFiles.length > 1) {
      setChatError("Attach one image per chat message.");
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
        };
        if (purpose === "post") setPostImages((current) => [...current, localImage]);
        else {
          setChatImage((current) => {
            if (current) {
              URL.revokeObjectURL(current.url);
              imageUrls.current.delete(current.url);
            }
            return localImage;
          });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "Image processing failed. Please try another image.";
        if (purpose === "post") setNotice({ kind: "error", text: message });
        else setChatError(message);
      }
    }
  }

  function removeLocalImage(image: LocalImage) {
    URL.revokeObjectURL(image.url);
    imageUrls.current.delete(image.url);
    setPostImages((current) => current.filter((item) => item.url !== image.url));
    setChatImage((current) => current?.url === image.url ? null : current);
    setAvatarImage((current) => current?.url === image.url ? null : current);
  }

  async function attachAvatar(file: File | undefined) {
    if (!file) return;
    try {
      const processed = await processImage(file, "avatar");
      const url = URL.createObjectURL(processed.blob);
      imageUrls.current.add(url);
      const nextImage = {
        url,
        name: file.name,
        size: processed.blob.size,
        width: processed.width,
        height: processed.height,
      };
      setAvatarImage((current) => {
        if (current) {
          URL.revokeObjectURL(current.url);
          imageUrls.current.delete(current.url);
        }
        return nextImage;
      });
      setAvatarError(null);
    } catch (error) {
      setAvatarError(error instanceof Error ? error.message : "Avatar processing failed. Please try another image.");
    }
  }

  function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  }

  function handleFriendsTouchStart(event: TouchEvent<HTMLDivElement>) {
    friendTouchStartY.current = event.touches[0]?.clientY ?? null;
  }

  function handleFriendsTouchEnd(event: TouchEvent<HTMLDivElement>) {
    const startY = friendTouchStartY.current;
    const endY = event.changedTouches[0]?.clientY;
    friendTouchStartY.current = null;
    if (startY !== null && endY !== undefined && endY - startY > 60) {
      setVoiceChatOpen(true);
    }
  }

  async function addComment(postId: string, text: string, parentId?: string) {
    const parsed = commentDraftSchema.safeParse({ body: text });
    if (!parsed.success) {
      setNotice({ kind: "error", text: parsed.error.issues.map((issue) => issue.message).join(" ") });
      return;
    }

    const validationError = await validateOnServer("/api/comments/validate", parsed.data, "comment");
    if (validationError) {
      setNotice({ kind: "error", text: validationError });
      return;
    }

    const comment: CommentItem = {
      id: makeId("comment"),
      author: "You",
      body: parsed.data.body,
      replies: [],
    };
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
    setNotice({ kind: "success", text: "Reply added in this demo." });
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
    if (share.kind === "message") sendMessage(share.text, share.image);
    if (share.kind === "comment" && share.postId) addComment(share.postId, share.text, share.parentId);
    if (share.kind === "post") {
      const [title, ...body] = share.text.split("\n");
      publishPost({ city: citySlug, title, body: body.join("\n"), tag: postTag });
    }
  }

  function renderComments(comments: CommentItem[], postId: string, depth = 0): ReactNode {
    return comments.filter((comment) =>
      !blockedAuthors.includes(comment.author) && !bannedAuthors.includes(comment.author),
    ).map((comment) => (
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
            label: `comment by ${comment.author}`,
          })}>Report</button>
          {comment.author !== "You" && (
            <button className="text-button" type="button" onClick={() => blockAuthor(comment.author)}>
              {blockedAuthors.includes(comment.author) ? "Blocked" : "Block"}
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
    <div className={`app-shell ${mobileView === "chat" ? "mobile-chat-mode" : ""}`} inert={ageGateOpen}>
      <aside className="sidebar" aria-label="VibeChat navigation">
        <SiteBrand />
        <div className="sidebar-label-row">
          <h2>Your cities</h2>
          <span className="demo-label">Demo</span>
        </div>
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
          <p>One account for every city. Google sign-in arrives in Phase 2.</p>
          <button className="button sign-in-button" type="button" onClick={() => setAuthOpen(true)}>Sign in</button>
          <div className="legal-links"><Link href="/privacy">Privacy</Link><Link href="/terms">Terms</Link></div>
        </div>
      </aside>

      <main ref={mainRef} className={`main-content ${mobileView === "chat" ? "mobile-chat-active" : ""}`}>
        <header className="topbar">
          <div className="breadcrumbs"><span>Community</span><span aria-hidden="true">/</span><strong>{city.name}</strong></div>
          <div className="topbar-actions">
            <label className="sr-only" htmlFor="post-search">Search posts in {city.name}</label>
            <input
              id="post-search"
              className="search-input post-search"
              value={postSearch}
              onChange={(event) => setPostSearch(event.target.value)}
              placeholder="Search this board"
              type="search"
            />
            <button className="button safety-center-button" type="button" onClick={() => setSafetyCenterOpen(true)}>
              Safety{ safetyReports.filter((report) => report.status === "open").length > 0
                ? ` · ${safetyReports.filter((report) => report.status === "open").length}`
                : ""}
            </button>
            <button className="button sign-in-mobile" type="button" onClick={() => setAuthOpen(true)}>Sign in</button>
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
            <section className="stories-section" aria-label="Community stories">
              <div className="stories-heading">
                <h2>Community stories</h2>
                <span className="subtle">Demo previews</span>
              </div>
              <div className="stories-list">
                {DEMO_STORIES.map((story) => (
                  <button
                    className="story-button"
                    key={story.id}
                    type="button"
                    aria-label={`View demo story by ${story.name} from ${story.city}`}
                    onClick={() => setActiveStory(story)}
                  >
                    <span className="story-ring"><span className="story-avatar">{story.initials}</span></span>
                    <span className="story-name">{story.name}</span>
                  </button>
                ))}
              </div>
            </section>

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
              <span className="subtle">Examples are mock content</span>
            </div>

            {loading ? (
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
                  const score = post.votes + (votes[post.id] ?? 0);
                  return (
                    <article className="card post-card" key={post.id}>
                      <div className="post-meta">
                        <span className="avatar">{post.initials}</span>
                        <div className="author-line"><strong>{post.author}</strong><span>{post.time}</span></div>
                        <span className="tag">{post.tag}</span>
                        <details className="post-menu">
                          <summary aria-label={`More actions for ${post.title}`}>•••</summary>
                          <div className="menu-panel">
                            <button type="button" onClick={() => openReport({
                              type: "post",
                              id: post.id,
                              author: post.author,
                              label: `post by ${post.author}`,
                            })}>Report post</button>
                            {!post.mine && <button type="button" onClick={() => blockAuthor(post.author)}>
                              {blockedAuthors.includes(post.author) ? "Block again" : "Block author"}
                            </button>}
                            {post.mine && <button type="button" onClick={() => {
                              post.images?.forEach(removeLocalImage);
                              setPosts((current) => current.filter((item) => item.id !== post.id));
                            }}>Delete post</button>}
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
                          <button className="icon-button" type="button" aria-label="Upvote post" aria-pressed={votes[post.id] === 1} onClick={() => setVotes((current) => ({ ...current, [post.id]: current[post.id] === 1 ? 0 : 1 }))}>↑</button>
                          <span>{score}</span>
                          <button className="icon-button" type="button" aria-label="Downvote post" aria-pressed={votes[post.id] === -1} onClick={() => setVotes((current) => ({ ...current, [post.id]: current[post.id] === -1 ? 0 : -1 }))}>↓</button>
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
            <footer className="page-footer"><span>VibeChat · Frontend preview</span><span><Link href="/privacy">Privacy</Link><Link href="/terms">Terms</Link></span></footer>
          </section>

          <section className="chat-panel" aria-label={`${city.name} chat`}>
            <div className="mobile-friends-bar" onTouchStart={handleFriendsTouchStart} onTouchEnd={handleFriendsTouchEnd}>
              <div className="mobile-friends-title">
                <strong>Friends</strong>
                <span>Demo preview</span>
              </div>
              <div className="mobile-friends-list" aria-label="Demo friends">
                {DEMO_FRIENDS.map((friend) => (
                  <button
                    className={`mobile-friend ${activeFriendId === friend.id ? "mobile-friend-active" : ""}`}
                    key={friend.id}
                    type="button"
                    aria-label={`${friend.name}, ${friend.online ? "online" : "offline"}, demo friend`}
                    aria-pressed={activeFriendId === friend.id}
                    onClick={() => setActiveFriendId(friend.id)}
                  >
                    <span className="mobile-friend-avatar">{friend.initials}</span>
                    <span className={`online-indicator ${friend.online ? "is-online" : ""}`} aria-hidden="true" />
                    <span className="mobile-friend-name">{friend.name}</span>
                  </button>
                ))}
              </div>
              <p className="voice-swipe-hint">Swipe down to open voice chat</p>
              <span className="sr-only" role="status" aria-live="polite">
                {activeFriend ? `${activeFriend.name} selected. Direct messaging is not connected in this preview.` : ""}
              </span>
            </div>

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
              <span className="demo-status"><span />Preview</span>
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
              {loading ? (
                <div className="chat-loading" role="status">Loading conversation…</div>
              ) : currentMessages.length === 0 ? (
                <div className="chat-empty">
                  <h3>No messages yet</h3>
                  <p>Start a conversation in {channels.find((channel) => channel.id === channelId)?.label}.</p>
                  <p className="subtle">This is a local preview. Messages are not sent to a server.</p>
                </div>
              ) : currentMessages.map((message) => (
                <article className={`chat-message ${message.fromYou ? "chat-message-own" : ""}`} key={message.id}>
                  {!message.fromYou && <span className="avatar avatar-small">MK</span>}
                  <div className="message-content">
                    <div className="message-meta"><strong>{message.fromYou ? "You" : "Friend"}</strong><time>{message.time}</time></div>
                    {message.body && <p>{message.body}</p>}
                    {message.image && <Image className="chat-image" src={message.image.url} alt={message.image.name} width={message.image.width} height={message.image.height} unoptimized />}
                  </div>
                  {message.fromYou && <span className="avatar avatar-small">YO</span>}
                </article>
              ))}
            </div>
            <form className="chat-form" onSubmit={submitMessage}>
              <label className="sr-only" htmlFor="chat-message">Message Chat-Chaat</label>
              <textarea id="chat-message" value={chatDraft} onKeyDown={handleComposerKeyDown} onChange={(event) => setChatDraft(event.target.value)} placeholder="Message Chat-Chaat…" maxLength={2000} rows={2} enterKeyHint="send" />
              <div className="image-attachments">
                <label className="button button-small" htmlFor="chat-image">Attach image</label>
                <input
                  className="image-file-input"
                  id="chat-image"
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={(event) => {
                    void attachImages(event.currentTarget.files, "chat");
                    event.currentTarget.value = "";
                  }}
                />
                <span className="subtle">JPEG, PNG or WebP · up to 5 MB · compressed to WebP, max 1600 px / 1.5 MB</span>
              </div>
              {chatImage && (
                <div className="chat-image-preview">
                  <Image src={chatImage.url} alt={chatImage.name} width={chatImage.width} height={chatImage.height} unoptimized />
                  <span className="subtle">{chatImage.width}×{chatImage.height} · {(chatImage.size / (1024 * 1024)).toFixed(2)} MB</span>
                  <button className="text-button" type="button" onClick={() => removeLocalImage(chatImage)}>Remove</button>
                </div>
              )}
              {chatError && <p className="chat-error" role="alert">{chatError}</p>}
              <div className="chat-form-footer">
                <span className="subtle">Preview only · Enter to send · Shift+Enter for a new line</span>
                <button className="button button-primary button-small" type="submit" disabled={!chatDraft.trim() && !chatImage}>Send</button>
              </div>
            </form>
          </section>
        </div>
      </main>

      {authOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setAuthOpen(false); }}>
          <section className="modal" role="dialog" aria-modal="true" aria-labelledby="auth-title">
            <button className="modal-close" type="button" onClick={() => setAuthOpen(false)} aria-label="Close sign-in dialog">×</button>
            <p className="eyebrow">Account</p><h2 id="auth-title">Google sign-in is coming in Phase 2</h2>
            <p>This preview does not create accounts or connect to Google. The planned account will work across cities and include a username, avatar, and home city.</p>
            <div className="image-attachments">
              <label className="button button-small" htmlFor="avatar-image">Choose local avatar preview</label>
              <input
                className="image-file-input"
                id="avatar-image"
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={(event) => {
                  void attachAvatar(event.currentTarget.files?.[0]);
                  event.currentTarget.value = "";
                }}
              />
              <span className="subtle">JPEG, PNG or WebP · up to 1 MB · compressed to WebP, max 512×512</span>
            </div>
            {avatarError && <p className="chat-error" role="alert">{avatarError}</p>}
            {avatarImage && (
              <div className="avatar-preview">
                <Image className="avatar" src={avatarImage.url} alt="Local avatar preview" width={avatarImage.width} height={avatarImage.height} unoptimized />
                <span className="subtle">{avatarImage.width}×{avatarImage.height} · {(avatarImage.size / (1024 * 1024)).toFixed(2)} MB · not uploaded</span>
                <button className="text-button" type="button" onClick={() => removeLocalImage(avatarImage)}>Remove avatar</button>
              </div>
            )}
            <p>Access to this 18+ preview requires confirming your age at the entry gate.</p>
            <button className="button button-primary" type="button" onClick={() => setAuthOpen(false)}>Close</button>
          </section>
        </div>
      )}

      {reportTarget && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setReportTarget(null); }}>
          <form className="modal" role="dialog" aria-modal="true" aria-labelledby="report-title" onSubmit={submitReport}>
            <button className="modal-close" type="button" onClick={() => setReportTarget(null)} aria-label="Close report dialog">×</button>
            <p className="eyebrow">Community safety · Preview</p><h2 id="report-title">Report {reportTarget.label}</h2>
            <p>Choose a reason. The report stays in this page and is not sent to a moderator.</p>
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
              {reportTarget.author !== "You" && (
                <button className="button" type="button" onClick={() => { blockAuthor(reportTarget.author); setReportTarget(null); }}>
                  Block {reportTarget.author}
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
            <p className="eyebrow">Community safety · Local preview</p>
            <h2 id="safety-title">Safety center</h2>
            <p>Reports, blocks, and bans here affect only this browser preview. There is no moderator account or live enforcement yet.</p>
            <section className="safety-section" aria-labelledby="reports-heading">
              <h3 id="reports-heading">Report queue ({safetyReports.filter((report) => report.status === "open").length} open)</h3>
              {safetyReports.length === 0 ? (
                <p className="subtle">No preview reports yet.</p>
              ) : (
                <div className="safety-list">
                  {safetyReports.map((report) => (
                    <article className="safety-item" key={report.reportId}>
                      <div>
                        <strong>{report.label}</strong>
                        <span>{report.reason.replaceAll("-", " ")} · {report.status}</span>
                        {report.details && <p>{report.details}</p>}
                      </div>
                      {report.status === "open" && (
                        <div className="safety-actions">
                          <button className="button button-small" type="button" onClick={() => dismissReport(report.reportId)}>Dismiss</button>
                          {report.author !== "You" && (
                            <button className="button button-small button-danger" type="button" onClick={() => banAuthor(report.author, report.reportId)}>
                              Ban in preview
                            </button>
                          )}
                        </div>
                      )}
                    </article>
                  ))}
                </div>
              )}
            </section>
            <section className="safety-section" aria-labelledby="blocked-heading">
              <h3 id="blocked-heading">Blocked accounts ({blockedAuthors.length})</h3>
              {blockedAuthors.length === 0 ? <p className="subtle">You have not blocked anyone in this preview.</p> : (
                <div className="safety-list">
                  {blockedAuthors.map((author) => (
                    <div className="safety-item" key={author}>
                      <strong>{author}</strong>
                      <button className="button button-small" type="button" onClick={() => unblockAuthor(author)}>Unblock</button>
                    </div>
                  ))}
                </div>
              )}
            </section>
            <section className="safety-section" aria-labelledby="banned-heading">
              <h3 id="banned-heading">Preview bans ({bannedAuthors.length})</h3>
              {bannedAuthors.length === 0 ? <p className="subtle">No preview bans.</p> : (
                <div className="safety-list">
                  {bannedAuthors.map((author) => (
                    <div className="safety-item" key={author}>
                      <strong>{author}</strong>
                      <button className="button button-small" type="button" onClick={() => liftBan(author)}>Lift ban</button>
                    </div>
                  ))}
                </div>
              )}
            </section>
            <button className="button button-primary" type="button" onClick={() => setSafetyCenterOpen(false)}>Done</button>
          </section>
        </div>
      )}

    </div>

      {ageGateOpen && (
        <div className="modal-backdrop age-gate-backdrop">
          <section className="modal age-gate-modal" role="alertdialog" aria-modal="true" aria-labelledby="age-gate-title">
            <p className="eyebrow">Age check · Required</p>
            <h2 id="age-gate-title">VibeChat is for adults 18+</h2>
            <p>You must be 18 or older to enter this preview. We store only your confirmation in this browser; we do not ask for your birth date or ID.</p>
            {ageGateDenied && <p className="age-gate-error" role="alert">You cannot continue to VibeChat if you are under 18.</p>}
            <label className="age-confirm">
              <input type="checkbox" checked={ageGateChecked} onChange={(event) => {
                const confirmed = event.target.checked;
                setAgeGateChecked(confirmed);
                setAgeGateDenied(false);
                if (confirmed) confirmAgeGate(true);
              }} />
              I confirm that I am 18 years of age or older.
            </label>
            <button className="button button-primary" type="button" disabled={!ageGateChecked} onClick={() => confirmAgeGate()}>Continue to VibeChat</button>
            <button className="text-button age-gate-underage" type="button" onClick={() => { setAgeGateChecked(false); setAgeGateDenied(true); }}>
              I am under 18
            </button>
          </section>
        </div>
      )}

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

      {activeStory && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setActiveStory(null); }}>
          <section className="modal story-modal" role="dialog" aria-modal="true" aria-labelledby="story-title">
            <button className="modal-close" type="button" onClick={() => setActiveStory(null)} aria-label="Close story">×</button>
            <div className="story-modal-author">
              <span className="story-ring"><span className="story-avatar">{activeStory.initials}</span></span>
              <div><strong id="story-title">{activeStory.name}</strong><span>{activeStory.city} · Demo story</span></div>
            </div>
            <p>{activeStory.text}</p>
            <button className="button button-primary" type="button" onClick={() => setActiveStory(null)}>Done</button>
          </section>
        </div>
      )}

      {voiceChatOpen && (
        <div className="modal-backdrop voice-chat-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setVoiceChatOpen(false); }}>
          <section className="modal voice-chat-modal" role="dialog" aria-modal="true" aria-labelledby="voice-chat-title">
            <button className="modal-close" type="button" onClick={() => setVoiceChatOpen(false)} aria-label="Close voice chat preview">×</button>
            <p className="eyebrow">Voice chat</p>
            <h2 id="voice-chat-title">Voice chat preview</h2>
            <p>Voice chat is not connected in this preview. Your microphone is not accessed.</p>
            <button className="button button-primary" type="button" onClick={() => setVoiceChatOpen(false)}>Got it</button>
          </section>
        </div>
      )}
    </>
  );
}
