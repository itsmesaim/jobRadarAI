import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  AlertCircle,
  Loader,
  Send,
  Sparkles,
  ExternalLink,
  Bot,
  FileText,
  Download,
  PanelLeft,
  Plus,
  X,
  Copy,
  Check,
  ChevronDown,
} from "lucide-react";
import toast from "react-hot-toast";
import { crawlerApi, jobsApi, userApi } from "../api/index";
import { getErrorDetail } from "../api/client";
import {
  LimitContactModal,
  parseLimitKindFromDetail,
  type LimitKind,
} from "../components/LimitContactModal";
import { ManualJDModal } from "../components/ManualJDModal";
import { useAuthStore } from "../hooks/useStores";
import { useIsMobile } from "../hooks/useIsMobile";
import { FaqRichText } from "../components/FaqRichText";
import { prettyRatedBy, sourceLabel } from "../utils/jobLabels";
import { fullDate, timeAgo } from "../utils/time";
import type { AiModelCatalogEntry, Job, MasterCvProposal, UserPreferences } from "../types";

type ChatAction = "download_cv" | "download_cover" | "copy_pack" | "rebuild_pack";

type ChatMsg = {
  role: string;
  content: string;
  at?: string;
  refuse?: boolean;
  answers?: string[];
  local?: boolean;
  actions?: ChatAction[];
  proposal?: MasterCvProposal;
};

const HELP_CHIPS = [
  {
    label: "Ask a follow-up",
    text: "What should I prioritize to close the gaps on this role?",
  },
  {
    label: "Form questions",
    text: "Here are the application form questions:\n1. \n2. \n",
  },
  { label: "CV tips", text: "How should I tailor my CV for this role using only my MASTER CV?" },
  { label: "Cover tips", text: "What should the cover letter emphasize for this job?" },
  { label: "How to use JobRadar", text: "How do I use JobRadar?" },
  { label: "Who built this?", text: "Who built JobRadar?" },
  { label: "What is a MASTER CV?", text: "What is a MASTER CV and how should I write mine?" },
];

type ChatIntent = "build_pack" | "rerate" | "chat";

function detectIntent(text: string): ChatIntent {
  const t = text.toLowerCase().trim();
  if (/\b(re-?rate|rate (again|this|it|me)|score (again|this))\b/.test(t)) return "rerate";
  if (
    /\b(build|make|generate|create|rebuild|write|draft).{0,48}(cv|resume|cover|apply\s*pack|letter)\b/.test(
      t,
    ) ||
    /\b(cv|resume|cover letter|apply pack).{0,24}(please|now|for me)\b/.test(t) ||
    /^(make|build|generate)\s+(a\s+)?(cv|cover|pack|resume)/.test(t)
  ) {
    return "build_pack";
  }
  return "chat";
}

function formatTokens(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${Math.round(n / 100) / 10}k`;
  return String(n);
}

function scoreClass(score: number | null | undefined) {
  if (score == null) return "";
  if (score >= 8) return "";
  if (score >= 6) return " mid";
  return " low";
}

function firstName(name?: string | null) {
  const n = (name || "").trim();
  if (!n) return "You";
  return n.split(/\s+/)[0];
}

function initial(name?: string | null) {
  const n = firstName(name);
  return (n[0] || "Y").toUpperCase();
}

/** Light markdown: **bold**, lines, - bullets */
function formatChatText(text: string): ReactNode {
  const lines = text.split("\n");
  return lines.map((line, i) => {
    const parts: ReactNode[] = [];
    const re = /\*\*(.+?)\*\*/g;
    let last = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(line))) {
      if (m.index > last) parts.push(line.slice(last, m.index));
      parts.push(
        <strong key={`${i}-${m.index}`} className="job-chat-strong">
          {m[1]}
        </strong>,
      );
      last = m.index + m[0].length;
    }
    if (last < line.length) parts.push(line.slice(last));
    if (!parts.length) parts.push(line || "\u00A0");

    const isBullet = /^\s*-\s+/.test(line);
    const isNext = /^\s*\*\*Next:\*\*/i.test(line) || /^Next:/i.test(line.trim());
    return (
      <div
        key={i}
        className={`job-chat-line${isBullet ? " is-bullet" : ""}${isNext ? " is-next" : ""}`}
      >
        {parts}
      </div>
    );
  });
}

function buildLocalRatingBrief(job: Job): string {
  const score = job.score;
  if (score == null) {
    return (
      "This job is not rated yet.\n\n" +
      "**Next:** tap Re-rate, then we can walk through fit, CV, and form answers."
    );
  }
  const where = job.company ? ` at ${job.company}` : "";
  const strengths = job.matched_strengths || [];
  const gaps = job.gaps || [];
  const lines = [
    `**Fit ${score}/10** for ${job.title || "this role"}${where}.`,
    "",
    "**Why this score**",
  ];
  if (job.verdict) lines.push(`- ${job.verdict}`);
  if (strengths.length) {
    lines.push("- Strengths:");
    strengths.slice(0, 5).forEach((s) => lines.push(`  - ${s}`));
  } else {
    lines.push("- Strengths: none listed on this rating yet.");
  }
  if (gaps.length) {
    lines.push("- Gaps:");
    gaps.slice(0, 5).forEach((g) => lines.push(`  - ${g}`));
  } else {
    lines.push("- Gaps: none flagged.");
  }
  if (job.apply_pack_ready) {
    lines.push(
      "",
      "**CV + cover:** already built for this rating.",
      "",
      "**Next:** Download CV / cover on the left, or paste employer form questions.",
    );
  } else {
    lines.push(
      "",
      "**Next:** Build CV + cover, ask a follow-up, or paste employer form questions.",
    );
  }
  return lines.join("\n");
}

function MasterCvProposalCard({ proposal }: { proposal: MasterCvProposal }) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(proposal);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  const submit = async (p: MasterCvProposal) => {
    setBusy(true);
    try {
      if (p.kind === "project") {
        await userApi.addMasterCvProject(p);
        toast.success(`Added “${p.name}” to MASTER CV`);
      } else if (p.kind === "experience") {
        await userApi.addMasterCvExperience(p);
        toast.success(`Added “${p.title}” to MASTER CV`);
      } else {
        await userApi.addMasterCvSkills(p);
        toast.success(`Added ${p.items.join(", ")} to MASTER CV skills`);
      }
      queryClient.invalidateQueries({ queryKey: ["cv"] });
      setDone(true);
    } catch (err: unknown) {
      toast.error(getErrorDetail(err) || "Could not update MASTER CV");
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return <div className="job-chat-proposal-done">Added to MASTER CV.</div>;
  }

  if (dismissed) {
    return <div className="job-chat-proposal-done">Kept chat-only.</div>;
  }

  if (editing) {
    return (
      <div className="job-chat-proposal-edit">
        {draft.kind === "project" && (
          <>
            <label>
              Name
              <input
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
            </label>
            <label>
              Description
              <textarea
                rows={2}
                value={draft.description || ""}
                onChange={(e) => setDraft({ ...draft, description: e.target.value })}
              />
            </label>
            <label>
              Technologies (comma separated)
              <input
                value={(draft.technologies || []).join(", ")}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    technologies: e.target.value
                      .split(",")
                      .map((s) => s.trim())
                      .filter(Boolean),
                  })
                }
              />
            </label>
          </>
        )}
        {draft.kind === "experience" && (
          <>
            <label>
              Title
              <input
                value={draft.title}
                onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              />
            </label>
            <label>
              Company
              <input
                value={draft.company || ""}
                onChange={(e) => setDraft({ ...draft, company: e.target.value })}
              />
            </label>
            <div className="job-chat-proposal-row">
              <label>
                Start
                <input
                  placeholder="2022"
                  value={draft.start || ""}
                  onChange={(e) => setDraft({ ...draft, start: e.target.value })}
                />
              </label>
              <label>
                End
                <input
                  placeholder="Present"
                  value={draft.end || ""}
                  onChange={(e) => setDraft({ ...draft, end: e.target.value })}
                />
              </label>
            </div>
            <label>
              Bullets (one per line)
              <textarea
                rows={3}
                value={(draft.bullets || []).join("\n")}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    bullets: e.target.value
                      .split("\n")
                      .map((s) => s.trim())
                      .filter(Boolean),
                  })
                }
              />
            </label>
          </>
        )}
        {draft.kind === "skill" && (
          <>
            <label>
              Category
              <input
                value={draft.category || "Other"}
                onChange={(e) => setDraft({ ...draft, category: e.target.value })}
              />
            </label>
            <label>
              Skills (comma separated)
              <input
                value={draft.items.join(", ")}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    items: e.target.value
                      .split(",")
                      .map((s) => s.trim())
                      .filter(Boolean),
                  })
                }
              />
            </label>
          </>
        )}
        <div className="job-chat-inline-chips">
          <button
            type="button"
            className="chip chip-primary"
            disabled={busy}
            onClick={() => void submit(draft)}
          >
            Save + Accept
          </button>
          <button
            type="button"
            className="chip"
            onClick={() => {
              setDraft(proposal);
              setEditing(false);
            }}
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="job-chat-inline-chips">
      <button
        type="button"
        className="chip chip-primary"
        disabled={busy}
        onClick={() => void submit(draft)}
      >
        Accept into MASTER CV
      </button>
      <button type="button" className="chip" onClick={() => setEditing(true)}>
        Edit
      </button>
      <button
        type="button"
        className="chip"
        onClick={() => {
          setDismissed(true);
          toast("Kept chat-only - nothing written to MASTER CV");
        }}
      >
        Keep chat-only
      </button>
    </div>
  );
}

export function JobChatPage() {
  const { jobId = "" } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const authUser = useAuthStore((s) => s.user);
  const displayName = firstName(authUser?.name);
  const avatarLetter = initial(authUser?.name);

  const [input, setInput] = useState("");
  const [stages, setStages] = useState<
    { id: string; label: string; sub?: string; done?: boolean; active?: boolean }[]
  >([
    { id: "rate", label: "Rate", sub: "Fit score" },
    { id: "draft", label: "Draft CV", sub: "Waiting" },
    { id: "ats", label: "ATS screen", sub: "Waiting" },
    { id: "revise", label: "Revise", sub: "Waiting" },
    { id: "humanize", label: "Humanize", sub: "Optional" },
  ]);
  const [stepOut, setStepOut] = useState(
    '{\n  "hint": "Rating summary loads when the job is ready"\n}',
  );
  const [stepOutputs, setStepOutputs] = useState<Record<string, string>>({});
  const [activeStepId, setActiveStepId] = useState("rate");
  const [limitKind, setLimitKind] = useState<LimitKind | null>(null);
  const [packBusy, setPackBusy] = useState(false);
  const [showRefuseChips, setShowRefuseChips] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [copiedPack, setCopiedPack] = useState(false);
  const [metaOpen, setMetaOpen] = useState(false);
  const [showPasteJd, setShowPasteJd] = useState(false);
  const [pastedJobId, setPastedJobId] = useState<string | null>(null);
  const messagesRef = useRef<HTMLDivElement>(null);

  const isMobileChat = useIsMobile(960);

  const jobQ = useQuery({
    queryKey: ["job-detail", jobId],
    queryFn: () => jobsApi.get(jobId),
    enabled: !!jobId,
  });
  const chatQ = useQuery({
    queryKey: ["job-chat", jobId],
    queryFn: () => jobsApi.getChat(jobId),
    enabled: !!jobId,
  });
  const jobListQ = useQuery({
    queryKey: ["jobs", "chat-rail"],
    queryFn: () => jobsApi.list({ limit: 20 }),
  });
  const prefsQ = useQuery({ queryKey: ["preferences"], queryFn: userApi.getPreferences });
  const statusQ = useQuery({
    queryKey: ["crawl-status"],
    queryFn: crawlerApi.status,
    refetchInterval: 60000,
  });
  const ratingModelsQ = useQuery({
    queryKey: ["ai-models", "rating"],
    queryFn: () => userApi.getAiModels("rating"),
  });
  const packModelsQ = useQuery({
    queryKey: ["ai-models", "apply_pack"],
    queryFn: () => userApi.getAiModels("apply_pack"),
  });

  const prefs = prefsQ.data;
  const job = jobQ.data;
  const storedMessages: ChatMsg[] = chatQ.data?.messages || [];
  const usage = statusQ.data;

  const [packAts, setPackAts] = useState<Job["apply_pack_ats"] | null>(null);
  useEffect(() => {
    if (job?.apply_pack_ats) setPackAts(job.apply_pack_ats);
  }, [job?.apply_pack_ats]);

  const ratingBrief = useMemo(() => (job ? buildLocalRatingBrief(job) : ""), [job]);

  const messages: ChatMsg[] = useMemo(() => {
    if (storedMessages.length) return storedMessages;
    if (!job || chatQ.isLoading) return [];
    return [
      {
        role: "assistant",
        content: ratingBrief,
        local: true,
        at: "brief",
        actions: job.apply_pack_ready
          ? (["download_cv", "download_cover", "copy_pack"] as ChatAction[])
          : undefined,
      },
    ];
  }, [storedMessages, job, ratingBrief, chatQ.isLoading]);

  const isFull = !!(
    usage?.is_admin ||
    usage?.token_quota_unlimited ||
    usage?.full_access ||
    (usage?.full_access_until && new Date(usage.full_access_until) > new Date())
  );
  const searchesLeft = isFull
    ? 999
    : Math.max(0, (usage?.search_limit ?? 0) - (usage?.searches_used ?? 0));
  const ratingsLeft = isFull
    ? 999
    : Math.max(0, (usage?.rating_limit ?? 0) - (usage?.ratings_used ?? 0));
  const dailyLimit = usage?.daily_token_limit ?? 0;
  const dailyUsed = usage?.daily_tokens_used ?? 0;
  const tokensLeft = dailyLimit > 0 ? Math.max(0, dailyLimit - dailyUsed) : null;
  const packsLeft = isFull
    ? 999
    : Math.max(
        0,
        usage?.apply_packs_remaining ??
          (usage?.apply_pack_limit ?? 0) - (usage?.apply_packs_used ?? 0),
      );
  const showLimitWarn =
    !isFull &&
    (searchesLeft <= 1 ||
      ratingsLeft <= 2 ||
      (tokensLeft != null && dailyLimit > 0 && tokensLeft <= dailyLimit * 0.2) ||
      packsLeft <= 1);

  // Scroll only the message list; scrollIntoView also moves the window and makes mobile jitter.
  useEffect(() => {
    const el = messagesRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [messages.length, packBusy, chatQ.isFetching]);

  // Mobile: lock page scroll and use the real nav height so the shell fits exactly.
  useEffect(() => {
    const root = document.documentElement;
    const nav = document.querySelector<HTMLElement>(".nav");
    const sync = () => {
      if (nav) root.style.setProperty("--nav-h", `${nav.offsetHeight}px`);
    };
    root.classList.add("chat-lock");
    sync();
    window.addEventListener("resize", sync);
    return () => {
      root.classList.remove("chat-lock");
      root.style.removeProperty("--nav-h");
      window.removeEventListener("resize", sync);
    };
  }, []);

  const packReady = !!job?.apply_pack_ready;

  useEffect(() => {
    if (job?.score != null) {
      const rateJson = JSON.stringify(
        {
          score: job.score,
          strengths: job.matched_strengths?.slice(0, 5) || [],
          gaps: job.gaps?.slice(0, 5) || [],
          verdict: job.verdict,
        },
        null,
        2,
      );
      setStages((s) =>
        s.map((x) => {
          if (x.id === "rate") {
            return { ...x, done: true, sub: `Scored ${job.score}`, active: !packReady };
          }
          if (packReady) {
            return { ...x, done: true, sub: "Done", active: x.id === "humanize" };
          }
          return x;
        }),
      );
      const packJson = packReady
        ? JSON.stringify(
            {
              status: "complete",
              source: "cached",
              downloads: ["cv.pdf", "cover-letter.pdf"],
              hint: "Pack already built for this rating. Download from the left, or Rebuild to regenerate.",
            },
            null,
            2,
          )
        : null;
      setStepOutputs((prev) => ({
        ...prev,
        rate: rateJson,
        ...(packJson ? { humanize: prev.humanize || packJson } : {}),
      }));
      if (packReady && packJson) {
        setActiveStepId("humanize");
        setStepOut(packJson);
      } else {
        setActiveStepId("rate");
        setStepOut(rateJson);
      }
    }
  }, [job?.score, job?.matched_strengths, job?.gaps, job?.verdict, packReady]);

  const selectStep = (id: string) => {
    setActiveStepId(id);
    setStages((s) => s.map((x) => ({ ...x, active: x.id === id })));
    const stored = stepOutputs[id];
    if (stored) {
      setStepOut(stored);
    } else {
      setStepOut(
        JSON.stringify(
          {
            step: id,
            status: "no output yet",
            hint: "Run Build CV + cover or Re-rate to fill this step.",
          },
          null,
          2,
        ),
      );
    }
    if (isMobileChat) {
      setDrawerOpen(false);
      setSheetOpen(true);
    }
  };

  const downloadCv = async () => {
    try {
      const { overflow, warnings } = await jobsApi.downloadApplyPackCv(jobId);
      if (warnings.length) {
        toast(warnings.slice(0, 3).join(" · "), { duration: 7000, icon: "⚠️" });
      } else if (overflow) {
        toast("CV downloaded (2 pages)", { icon: "ℹ️" });
      } else {
        toast.success("CV downloaded");
      }
    } catch {
      toast.error("CV not ready yet - build the apply pack first");
    }
  };

  const downloadCover = async () => {
    try {
      await jobsApi.downloadApplyPackCoverLetter(jobId);
      toast.success("Cover letter downloaded");
    } catch {
      toast.error("Cover letter not ready yet - build the apply pack first");
    }
  };

  const copyPack = async () => {
    try {
      const { brief } = await jobsApi.getBrief(jobId);
      await navigator.clipboard.writeText(brief);
      setCopiedPack(true);
      toast.success("Apply pack copied - paste into ChatGPT / Claude / Grok");
      setTimeout(() => setCopiedPack(false), 2000);
    } catch (err: unknown) {
      const ax = err as { response?: { status?: number; data?: { detail?: string } } };
      const detail = ax.response?.data?.detail;
      if (ax.response?.status === 409 && detail) {
        toast(detail, { duration: 8000 });
      } else {
        toast.error(detail || "Could not copy apply pack");
      }
    }
  };

  const pushLocalThread = (userText: string, assistant: ChatMsg) => {
    const prev = (queryClient.getQueryData(["job-chat", jobId]) as { messages: ChatMsg[] })
      ?.messages;
    const base = prev || [];
    const next = [...base];
    if (userText.trim()) {
      next.push({ role: "user", content: userText, at: new Date().toISOString() });
    }
    next.push(assistant);
    queryClient.setQueryData(["job-chat", jobId], { messages: next });
  };

  const chatMutation = useMutation({
    mutationFn: async (message: string) => {
      const started = Date.now();
      const data = await jobsApi.postChat(jobId, message);
      // Local/FAQ replies are instant - keep a short "thinking" beat so it feels natural
      const minMs = 650 + Math.floor(Math.random() * 450);
      const wait = minMs - (Date.now() - started);
      if (wait > 0) {
        await new Promise((r) => setTimeout(r, wait));
      }
      return data;
    },
    onSuccess: (data, message) => {
      queryClient.setQueryData(["job-chat", jobId], { messages: data.messages });
      setShowRefuseChips(!!data.refuse);
      if (data.action === "build_pack") {
        void runPack(false, false);
      }
      if (data.action === "propose_master_cv" && data.proposal) {
        const prev = (
          queryClient.getQueryData(["job-chat", jobId]) as { messages: ChatMsg[] } | undefined
        )?.messages;
        if (prev?.length) {
          const next = [...prev];
          const last = { ...next[next.length - 1], proposal: data.proposal };
          next[next.length - 1] = last;
          queryClient.setQueryData(["job-chat", jobId], { messages: next });
        }
      }
      if (data.answers?.length) {
        setStepOut(JSON.stringify({ answers: data.answers }, null, 2));
        setStages((s) =>
          s.map((x) => ({
            ...x,
            active: x.id === "ats",
            sub: x.id === "ats" ? "Form answers" : x.sub,
          })),
        );
      }
    },
    onError: (err: any, message: string) => {
      const detail = err?.response?.data?.detail || "";
      const detailStr = typeof detail === "string" ? detail : "";
      if (detailStr.toLowerCase().includes("limit")) {
        setLimitKind(parseLimitKindFromDetail(detailStr));
        toast.error(detailStr);
        return;
      }
      // Soft retry - not a roast
      pushLocalThread(message, {
        role: "assistant",
        content:
          "Couldn't finish that reply just now. Try again, or use Re-rate / Build CV + cover.",
        at: new Date().toISOString(),
      });
      setShowRefuseChips(false);
    },
  });

  const rateMutation = useMutation({
    mutationFn: () => jobsApi.rateOne(jobId),
    onSuccess: () => {
      toast.success("Rated");
      queryClient.invalidateQueries({ queryKey: ["job-detail", jobId] });
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
      queryClient.invalidateQueries({ queryKey: ["crawl-status"] });
      queryClient.invalidateQueries({ queryKey: ["job-chat", jobId] });
      setStages((s) =>
        s.map((x) =>
          x.id === "rate" ? { ...x, done: true, active: true, sub: "Just refreshed" } : x,
        ),
      );
    },
    onError: (err: any) => {
      const detail = err?.response?.data?.detail || "Rating failed";
      toast.error(detail);
      if (String(detail).toLowerCase().includes("limit")) {
        setLimitKind(parseLimitKindFromDetail(String(detail)));
      }
    },
  });

  const prefsMutation = useMutation({
    mutationFn: (patch: Partial<UserPreferences>) =>
      userApi.updatePreferences({ ...(prefs || {}), ...patch } as UserPreferences),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["preferences"] });
      toast.success("Model updated");
    },
    onError: () => toast.error("Could not update model"),
  });

  const send = (preset?: string) => {
    const text = (preset ?? input).trim();
    if (!text || chatMutation.isPending || packBusy || rateMutation.isPending) return;
    if (!preset) setInput("");
    setShowRefuseChips(false);

    const intent = detectIntent(text);
    if (intent === "build_pack") {
      if (packReady) {
        pushLocalThread(text, {
          role: "assistant",
          content:
            "Your **CV + cover letter** for this rating are already ready.\n\n" +
            "Use the buttons below, or open **Tools** anytime for the same downloads.\n\n" +
            "**Next:** download the PDFs, or paste employer form questions.",
          at: new Date().toISOString(),
          actions: ["download_cv", "download_cover", "copy_pack", "rebuild_pack"],
        });
        return;
      }
      pushLocalThread(text, {
        role: "assistant",
        content:
          "Building your tailored **CV + cover letter** for this job now. I will drop download buttons here when it finishes.",
        at: new Date().toISOString(),
      });
      void runPack(false, false);
      return;
    }
    if (intent === "rerate") {
      pushLocalThread(text, {
        role: "assistant",
        content: "Re-rating this job with your current rating model…",
        at: new Date().toISOString(),
      });
      rateMutation.mutate();
      return;
    }
    chatMutation.mutate(text);
  };

  const runPack = async (confirmLow = false, regenerate = false) => {
    if (packBusy) return;
    const score = job?.score ?? 0;
    if (score < 6 && !confirmLow) {
      if (!window.confirm(`Fit is ${score}/10. Build CV anyway?`)) return;
      confirmLow = true;
    }
    const forceRegen = regenerate || !packReady;
    setPackBusy(true);
    const order = ["rate", "draft", "ats", "revise", "humanize"];
    setStages((s) =>
      s.map((x) => ({
        ...x,
        active: x.id === "draft",
        done: x.id === "rate" ? true : false,
        sub: x.id === "draft" ? "In progress" : x.id === "rate" ? x.sub || "Scored" : "Waiting",
      })),
    );
    selectStep("draft");
    try {
      const { ats } = await jobsApi.streamApplyPack(
        jobId,
        (ev) => {
          const stage = ev.stage;
          const map: Record<string, string> = {
            gathering: "draft",
            drafting: "draft",
            screening: "ats",
            revising: "revise",
            humanize: "humanize",
            brief: "humanize",
            packaging: "humanize",
          };
          const id = map[stage] || "draft";
          const payload = JSON.stringify(
            { stage, messages: ev.messages || [], at: new Date().toISOString() },
            null,
            2,
          );
          setStepOutputs((prev) => ({ ...prev, [id]: payload }));
          setActiveStepId(id);
          setStepOut(payload);
          setStages((s) =>
            s.map((x) => {
              const xi = order.indexOf(x.id);
              const ai = order.indexOf(id);
              return {
                ...x,
                active: x.id === id,
                done: xi >= 0 && ai >= 0 ? xi < ai : x.done,
                sub:
                  x.id === id
                    ? "In progress"
                    : xi < ai
                      ? "Done"
                      : x.id === "rate"
                        ? x.sub
                        : "Waiting",
              };
            }),
          );
        },
        forceRegen,
        "all",
        "",
        confirmLow || score < 6,
      );
      const finalJson = JSON.stringify(
        {
          status: "complete",
          ats: ats || null,
          downloads: ["cv.pdf", "cover-letter.pdf"],
        },
        null,
        2,
      );
      setStepOutputs((prev) => ({
        ...prev,
        humanize: finalJson,
        revise: prev.revise || finalJson,
      }));
      setActiveStepId("humanize");
      setStepOut(finalJson);
      setStages((s) =>
        s.map((x) => ({
          ...x,
          done: true,
          active: x.id === "humanize",
          sub: "Done",
        })),
      );
      if (ats) setPackAts(ats);
      const unaudited = !!ats?.unaudited;
      const needsInput = (ats?.user_questions || []).length > 0;
      const humFallback = ats?.humanizer_fallback || null;
      if (humFallback) {
        toast(
          humFallback === "timeout"
            ? "Humanizer timed out, shipped pre-humanize draft"
            : "Humanizer reverted (integrity), shipped pre-humanize draft",
          { duration: 8000, icon: "⚠️" },
        );
      } else if (unaudited) {
        toast("Apply pack ready, ATS screen timed out (unaudited)", {
          duration: 7000,
          icon: "⚠️",
        });
      } else if (needsInput) {
        toast("Apply pack ready, some items need your input", {
          duration: 6000,
          icon: "ℹ️",
        });
      } else {
        toast.success("Apply pack ready - download CV and cover below");
      }
      queryClient.invalidateQueries({ queryKey: ["job-detail", jobId] });
      queryClient.invalidateQueries({ queryKey: ["crawl-status"] });
      const qLines = (ats?.user_questions || [])
        .slice(0, 6)
        .map((q) => `- ${q}`)
        .join("\n");
      const fallbackLine =
        humFallback === "timeout"
          ? "**Humanizer fallback:** timed out. This pack uses the pre-humanize draft.\n\n"
          : humFallback
            ? "**Humanizer fallback:** integrity check failed. This pack uses the pre-humanize draft.\n\n"
            : "";
      pushLocalThread("", {
        role: "assistant",
        content:
          (unaudited
            ? "**CV + cover letter are ready (ATS unaudited).** The screen timed out, so treat alignment as unchecked.\n\n"
            : "**CV + cover letter are ready.**\n\n") +
          fallbackLine +
          (qLines ? `**Needs your input:**\n${qLines}\n\n` : "") +
          "Download below (same files stay in **Tools** whenever you need them).\n\n" +
          "**Next:** Apply here when you are happy with the pack.",
        at: new Date().toISOString(),
        actions: ["download_cv", "download_cover", "copy_pack"],
      });
    } catch (err: any) {
      const detail = err?.message || err?.response?.data?.detail || "Apply pack failed";
      const failJson = JSON.stringify({ status: "failed", detail: String(detail) }, null, 2);
      setStepOutputs((prev) => ({ ...prev, [activeStepId]: failJson }));
      setStepOut(failJson);
      toast.error(String(detail));
      if (String(detail).toLowerCase().includes("limit")) {
        setLimitKind(parseLimitKindFromDetail(String(detail)));
      }
      setStages((s) => s.map((x) => (x.active ? { ...x, sub: "Failed", active: true } : x)));
    } finally {
      setPackBusy(false);
    }
  };

  const ratingModels: AiModelCatalogEntry[] = ratingModelsQ.data?.models || [];
  const packModels: AiModelCatalogEntry[] = packModelsQ.data?.models || [];

  const ratingValue = useMemo(() => {
    if (!prefs?.rating_provider) return "";
    return `${prefs.rating_provider}::${prefs.rating_model || ""}`;
  }, [prefs]);
  const packValue = useMemo(() => {
    if (!prefs?.apply_pack_provider) return "";
    return `${prefs.apply_pack_provider}::${prefs.apply_pack_model || ""}`;
  }, [prefs]);

  if (jobQ.isError) {
    return (
      <div className="page-shell">
        <p>Job not found.</p>
        <Link to="/">Back to jobs</Link>
      </div>
    );
  }

  const score = job?.score;

  const modelsFields = (
    <>
      <label>
        Rating model
        <select
          value={ratingValue}
          onChange={(e) => {
            const v = e.target.value;
            if (!v) {
              prefsMutation.mutate({ rating_provider: "", rating_model: "" });
              return;
            }
            const [provider, model] = v.split("::");
            prefsMutation.mutate({ rating_provider: provider, rating_model: model });
          }}
        >
          <option value="">App default</option>
          {ratingModels.map((m) => (
            <option key={`${m.provider}::${m.model}`} value={`${m.provider}::${m.model}`}>
              {m.label}
            </option>
          ))}
        </select>
      </label>
      <label>
        Apply-pack model
        <select
          value={packValue}
          onChange={(e) => {
            const v = e.target.value;
            if (!v) {
              prefsMutation.mutate({ apply_pack_provider: "", apply_pack_model: "" });
              return;
            }
            const [provider, model] = v.split("::");
            prefsMutation.mutate({
              apply_pack_provider: provider,
              apply_pack_model: model,
            });
          }}
        >
          <option value="">App default</option>
          {packModels.map((m) => (
            <option key={`${m.provider}::${m.model}`} value={`${m.provider}::${m.model}`}>
              {m.label}
            </option>
          ))}
        </select>
      </label>
    </>
  );

  return (
    <div className={`job-chat-shell${drawerOpen || sheetOpen ? " has-overlay" : ""}`}>
      <header className="job-chat-bar">
        <button type="button" className="job-chat-back" onClick={() => navigate("/")}>
          <ArrowLeft size={18} />
          <span className="job-chat-back-label">Jobs</span>
        </button>
        <div className="job-chat-heading">
          <h1>{jobQ.isLoading ? "Loading…" : job?.title || "Job"}</h1>
          {(job?.company || job?.location) && (
            <p className="job-chat-heading-meta">
              {[job?.company, job?.location].filter(Boolean).join(" · ")}
            </p>
          )}
        </div>
        {score != null && <span className={`job-chat-score${scoreClass(score)}`}>{score}/10</span>}
        {job?.url ? (
          <a
            className="btn btn-primary job-chat-apply job-chat-apply--desktop"
            href={job.url}
            target="_blank"
            rel="noopener noreferrer"
          >
            <ExternalLink size={14} />
            <span className="job-chat-apply-label">Apply here</span>
          </a>
        ) : null}
        <button
          type="button"
          className="job-chat-menu-btn"
          aria-label="Open tools menu"
          onClick={() => setDrawerOpen(true)}
        >
          <PanelLeft size={20} />
        </button>
      </header>

      {job && (
        <div className="job-chat-meta-wrap">
          <button
            type="button"
            className="job-chat-meta-toggle"
            aria-expanded={metaOpen}
            onClick={() => setMetaOpen((v) => !v)}
          >
            {metaOpen ? "Hide source & timing" : "Show source & timing"}
            <ChevronDown
              size={14}
              style={{
                transform: metaOpen ? "rotate(180deg)" : "none",
                transition: "transform 0.15s",
              }}
            />
          </button>
          {metaOpen && (
            <div className="job-chat-meta-strip" aria-label="Job source and timing">
              <span className="job-chat-meta-pill is-source">{sourceLabel(job.source)}</span>
              {job.crawled_at && (
                <span className="job-chat-meta-pill" title={fullDate(job.crawled_at)}>
                  Pulled {timeAgo(job.crawled_at)}
                </span>
              )}
              {job.rated_at && (
                <span className="job-chat-meta-pill" title={fullDate(job.rated_at)}>
                  Rated {timeAgo(job.rated_at)}
                </span>
              )}
              {job.rated_by_model && (
                <span className="job-chat-meta-pill" title={job.rated_by_model}>
                  {prettyRatedBy(job.rated_by_model)}
                </span>
              )}
            </div>
          )}
        </div>
      )}

      {showLimitWarn && (
        <div className="dash-limit-warning job-chat-limit" role="status">
          <AlertCircle size={14} />
          <div className="dash-limit-warning-copy">
            <strong>Running low</strong>
            <span>
              {[
                searchesLeft <= 1 ? `${searchesLeft} searches left` : null,
                ratingsLeft <= 2 ? `${ratingsLeft} ratings left` : null,
                tokensLeft != null && dailyLimit > 0 && tokensLeft <= dailyLimit * 0.2
                  ? `${formatTokens(tokensLeft)} AI tokens left`
                  : null,
                packsLeft <= 1 ? `${packsLeft} CV packs left` : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </span>
          </div>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => setLimitKind(tokensLeft === 0 ? "token_daily" : "rating")}
          >
            Request more
          </button>
        </div>
      )}

      <div className="job-chat-models job-chat-models--desktop">{modelsFields}</div>

      {(drawerOpen || sheetOpen) && (
        <button
          type="button"
          className="job-chat-scrim"
          aria-label="Close panel"
          onClick={() => {
            setDrawerOpen(false);
            setSheetOpen(false);
          }}
        />
      )}

      <div className="job-chat-grid">
        <aside className={`job-chat-rail${drawerOpen ? " is-open" : ""}`}>
          <div className="job-chat-drawer-head">
            <strong>Tools</strong>
            <button
              type="button"
              className="job-chat-drawer-close"
              aria-label="Close menu"
              onClick={() => setDrawerOpen(false)}
            >
              <X size={18} />
            </button>
          </div>
          <button
            type="button"
            className="btn btn-secondary job-chat-paste-jd"
            onClick={() => setShowPasteJd(true)}
          >
            <Plus size={14} /> Paste JD → new job
          </button>
          <h2>Jobs</h2>
          <div className="job-chat-siblings">
            {(jobListQ.data?.jobs || []).map((j) => (
              <button
                key={j.id}
                type="button"
                className={`job-chat-sibling${j.id === jobId ? " is-selected" : ""}`}
                onClick={() => {
                  if (j.id === jobId) {
                    setDrawerOpen(false);
                    return;
                  }
                  setDrawerOpen(false);
                  navigate(`/jobs/${j.id}`);
                }}
              >
                <div className="job-chat-sibling-title">{j.title}</div>
                <div className="job-chat-sibling-sub">
                  {j.score != null ? `${j.score}/10` : "Not rated"}
                  {j.company ? ` · ${j.company}` : ""}
                </div>
              </button>
            ))}
            {jobListQ.isLoading && <p className="job-chat-rail-hint">Loading jobs…</p>}
          </div>
          <div className="job-chat-models job-chat-models--drawer">{modelsFields}</div>
          {packAts &&
            (packAts.unaudited ||
              packAts.humanizer_fallback ||
              (packAts.user_questions || []).length > 0) && (
              <div className={`job-chat-ats-panel${packAts.unaudited ? " is-unaudited" : ""}`}>
                {packAts.unaudited && (
                  <div className="job-chat-ats-row">
                    <span className="job-chat-ats-badge">Unaudited</span>
                    <span>ATS screen did not finish</span>
                  </div>
                )}
                {packAts.humanizer_fallback && (
                  <div className="job-chat-ats-row">
                    <span className="job-chat-ats-list-label">Humanizer fallback</span>
                    <p className="job-chat-ats-fallback-text">
                      {packAts.humanizer_fallback === "timeout"
                        ? "Humanizer timed out. This pack uses the pre-humanize draft."
                        : "Humanizer failed integrity checks. This pack uses the pre-humanize draft."}
                    </p>
                  </div>
                )}
                {(packAts.user_questions || []).length > 0 && (
                  <div className="job-chat-ats-row">
                    <span className="job-chat-ats-list-label">Needs your input</span>
                    <ul className="job-chat-ats-list">
                      {(packAts.user_questions || []).slice(0, 8).map((q, i) => (
                        <li key={i}>{q}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          <h2>Run steps</h2>
          <p className="job-chat-rail-hint">Tap a step to inspect its output</p>
          {stages.map((s) => (
            <button
              key={s.id}
              type="button"
              className={`job-chat-step${activeStepId === s.id ? " is-active" : ""}${s.done ? " is-done" : ""}`}
              onClick={() => selectStep(s.id)}
            >
              <span className={`job-chat-dot${s.done ? " done" : s.active ? " run" : " wait"}`} />
              <div>
                <div className="job-chat-step-label">{s.label}</div>
                {s.sub && <div className="job-chat-step-sub">{s.sub}</div>}
              </div>
            </button>
          ))}
          <div className="job-chat-actions">
            {job?.url ? (
              <a
                className="btn btn-primary job-chat-apply-drawer"
                href={job.url}
                target="_blank"
                rel="noopener noreferrer"
              >
                <ExternalLink size={14} /> Apply here
              </a>
            ) : null}
            <button
              type="button"
              className="btn btn-secondary"
              disabled={rateMutation.isPending}
              onClick={() => rateMutation.mutate()}
            >
              {rateMutation.isPending ? <Loader size={14} className="animate-spin" /> : null}
              Re-rate
            </button>
            {packReady ? (
              <>
                <button type="button" className="btn btn-primary" onClick={() => void downloadCv()}>
                  <FileText size={14} /> Download CV
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => void downloadCover()}
                >
                  <Download size={14} /> Download cover
                </button>
                <button type="button" className="btn btn-secondary" onClick={() => void copyPack()}>
                  {copiedPack ? <Check size={14} /> : <Copy size={14} />}
                  {copiedPack ? "Copied" : "Copy pack"}
                </button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={packBusy}
                  onClick={() => void runPack(false, true)}
                >
                  {packBusy ? (
                    <Loader size={14} className="animate-spin" />
                  ) : (
                    <Sparkles size={14} />
                  )}
                  Rebuild CV + cover
                </button>
              </>
            ) : (
              <button
                type="button"
                className="btn btn-primary"
                disabled={packBusy}
                onClick={() => void runPack(false, false)}
              >
                {packBusy ? <Loader size={14} className="animate-spin" /> : <Sparkles size={14} />}
                Build CV + cover
              </button>
            )}
          </div>
        </aside>

        <section className="job-chat-thread">
          <div className="job-chat-hello">
            Chatting about <strong>{job?.title || "this role"}</strong>
            {job?.company ? ` · ${job.company}` : ""}
          </div>
          <div className="job-chat-messages" ref={messagesRef}>
            {messages.map((m, i) => {
              const isUser = m.role === "user";
              return (
                <div
                  key={`${m.at || i}-${i}`}
                  className={`job-chat-row ${isUser ? "is-user" : "is-bot"}`}
                >
                  <div className={`job-chat-avatar ${isUser ? "is-user" : "is-bot"}`} aria-hidden>
                    {isUser ? avatarLetter : <Bot size={16} />}
                  </div>
                  <div
                    className={`job-chat-bubble ${isUser ? "is-user" : "is-bot"}${m.refuse ? " is-refuse" : ""}${m.local ? " is-brief" : ""}`}
                  >
                    <div className="job-chat-who">
                      {isUser ? displayName : "JobRadar"}
                      {m.local ? " · rating summary" : ""}
                    </div>
                    <div className="job-chat-body">
                      {isUser ? formatChatText(m.content) : <FaqRichText text={m.content} />}
                    </div>
                    {m.proposal && <MasterCvProposalCard proposal={m.proposal} />}
                    {!!m.actions?.length && (
                      <div className="job-chat-inline-chips">
                        {m.actions.includes("download_cv") && (
                          <button
                            type="button"
                            className="chip chip-primary"
                            onClick={() => void downloadCv()}
                          >
                            Download CV
                          </button>
                        )}
                        {m.actions.includes("download_cover") && (
                          <button
                            type="button"
                            className="chip chip-primary"
                            onClick={() => void downloadCover()}
                          >
                            Download cover
                          </button>
                        )}
                        {m.actions.includes("copy_pack") && (
                          <button type="button" className="chip" onClick={() => void copyPack()}>
                            {copiedPack ? "Copied" : "Copy pack"}
                          </button>
                        )}
                        {m.actions.includes("rebuild_pack") && (
                          <button
                            type="button"
                            className="chip"
                            onClick={() => void runPack(false, true)}
                          >
                            Rebuild pack
                          </button>
                        )}
                      </div>
                    )}
                    {((m.refuse && i === messages.length - 1 && showRefuseChips) ||
                      (m.local &&
                        i === messages.length - 1 &&
                        !storedMessages.length &&
                        !m.actions?.length)) && (
                      <div className="job-chat-inline-chips">
                        {HELP_CHIPS.filter((c) => !c.label.startsWith("Who")).map((c) => (
                          <button
                            key={c.label}
                            type="button"
                            className="chip"
                            onClick={() => send(c.text)}
                          >
                            {c.label}
                          </button>
                        ))}
                        {!packReady && (
                          <button
                            type="button"
                            className="chip chip-primary"
                            onClick={() => void runPack(false, false)}
                          >
                            Build CV + cover
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
            {chatMutation.isPending && (
              <div className="job-chat-row is-bot">
                <div className="job-chat-avatar is-bot" aria-hidden>
                  <Bot size={16} />
                </div>
                <div className="job-chat-bubble is-bot">
                  <div className="job-chat-who">JobRadar</div>
                  <Loader size={14} className="animate-spin" /> Working…
                </div>
              </div>
            )}
          </div>
          <div className="job-chat-composer">
            <div className="job-chat-composer-box">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value.slice(0, 4000))}
                placeholder="Ask a follow-up, or paste application form questions…"
                rows={2}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    send();
                  }
                }}
              />
              <button
                type="button"
                className="btn btn-primary"
                disabled={!input.trim() || chatMutation.isPending}
                onClick={() => send()}
              >
                <Send size={14} /> Send
              </button>
            </div>
            <p className="job-chat-hint">
              {packReady
                ? "Pack is ready - download CV / cover on the left, or ask a follow-up / paste form questions."
                : "Ask about gaps, paste form questions, or say “make a CV and cover” to build this role’s pack."}
            </p>
          </div>
        </section>

        <aside className={`job-chat-inspector${sheetOpen ? " is-open" : ""}`}>
          <div className="job-chat-sheet-handle" aria-hidden />
          <div className="job-chat-drawer-head">
            <strong>Step · {activeStepId}</strong>
            <button
              type="button"
              className="job-chat-drawer-close"
              aria-label="Close step output"
              onClick={() => setSheetOpen(false)}
            >
              <X size={18} />
            </button>
          </div>
          <div className="job-chat-badge">structured</div>
          <pre>{stepOut}</pre>
        </aside>
      </div>

      {limitKind && <LimitContactModal kind={limitKind} onClose={() => setLimitKind(null)} />}
      {showPasteJd && (
        <ManualJDModal
          canRate={!isFull ? ratingsLeft > 0 : true}
          ratingsRemaining={ratingsLeft}
          onLimitReached={setLimitKind}
          onClose={() => {
            setShowPasteJd(false);
            if (pastedJobId) {
              const id = pastedJobId;
              setPastedJobId(null);
              navigate(`/jobs/${id}`);
            }
          }}
          onAdded={(id) => {
            setPastedJobId(id ?? null);
            queryClient.invalidateQueries({ queryKey: ["jobs"] });
            queryClient.invalidateQueries({ queryKey: ["crawl-status"] });
          }}
        />
      )}
    </div>
  );
}
