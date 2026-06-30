import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Search,
  Plus,
  RefreshCw,
  SlidersHorizontal,
  AlertCircle,
  X,
  Loader,
  Zap,
  Cpu,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import toast from "react-hot-toast";
import { JobCard } from "../components/JobCard";
import { ManualJDModal } from "../components/ManualJDModal";
import {
  LimitContactModal,
  parseLimitKindFromDetail,
  type LimitKind,
} from "../components/LimitContactModal";
import { jobsApi, crawlerApi } from "../api/index";
import { useAuthStore } from "../hooks/useStores";

type ScoreFilterId = "6plus" | "7plus" | "8plus" | "below6" | "unrated" | "all";
type ViewMode = "active" | "all";

const SCORE_FILTER_OPTS: {
  id: ScoreFilterId;
  label: string;
  hint: string;
  score_min: number;
  score_max: number;
  rating: "all" | "rated" | "unrated";
}[] = [
  {
    id: "6plus",
    label: "6+",
    hint: "Score 6–10",
    score_min: 6,
    score_max: 10,
    rating: "rated",
  },
  {
    id: "7plus",
    label: "7+",
    hint: "Score 7–10 — strong matches",
    score_min: 7,
    score_max: 10,
    rating: "rated",
  },
  {
    id: "8plus",
    label: "8+",
    hint: "Score 8–10 — top picks",
    score_min: 8,
    score_max: 10,
    rating: "rated",
  },
  {
    id: "below6",
    label: "Below 6",
    hint: "Score 1–5",
    score_min: 1,
    score_max: 5,
    rating: "rated",
  },
  {
    id: "unrated",
    label: "Unrated",
    hint: "Waiting for AI score",
    score_min: 0,
    score_max: 10,
    rating: "unrated",
  },
  {
    id: "all",
    label: "All scores",
    hint: "Every job in your account",
    score_min: 0,
    score_max: 10,
    rating: "all",
  },
];

const STATUS_OPTS: { label: string; value: string | undefined }[] = [
  { label: "All", value: undefined },
  { label: "New", value: "NEW" },
  { label: "Saved", value: "SAVED" },
  { label: "Half applied", value: "HALF_APPLIED" },
  { label: "Applied", value: "APPLIED" },
  { label: "Follow up", value: "FOLLOWUP" },
  { label: "Interviewing", value: "INTERVIEWING" },
  { label: "Offer", value: "OFFER" },
  { label: "Rejected", value: "REJECTED" },
];

const SOURCE_OPTS: { label: string; value: string | undefined }[] = [
  { label: "All sources", value: undefined },
  { label: "Jooble", value: "jooble" },
  { label: "Indeed", value: "jobsapi-indeed" },
  { label: "Manual", value: "manual" },
];

function formatTokens(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(0)}k`;
  return String(n);
}

function Pagination({
  page,
  totalPages,
  onPage,
}: {
  page: number;
  totalPages: number;
  onPage: (p: number) => void;
}) {
  const pages: (number | "…")[] = [];

  if (totalPages <= 7) {
    for (let i = 1; i <= totalPages; i++) pages.push(i);
  } else {
    pages.push(1);
    if (page > 3) pages.push("…");
    for (let i = Math.max(2, page - 1); i <= Math.min(totalPages - 1, page + 1); i++) pages.push(i);
    if (page < totalPages - 2) pages.push("…");
    pages.push(totalPages);
  }

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 4,
        marginTop: 32,
        flexWrap: "wrap",
      }}
    >
      <button
        onClick={() => onPage(page - 1)}
        disabled={page === 1}
        className="btn btn-ghost"
        style={{ padding: "8px 14px", fontSize: 13, gap: 4 }}
      >
        <ChevronLeft size={14} /> Prev
      </button>

      {pages.map((p, i) =>
        p === "…" ? (
          <span
            key={`e${i}`}
            style={{
              padding: "8px 6px",
              color: "var(--text-muted)",
              fontSize: 13,
            }}
          >
            …
          </span>
        ) : (
          <button
            key={p}
            onClick={() => onPage(p as number)}
            className={p === page ? "btn btn-primary" : "btn btn-ghost"}
            style={{
              padding: "8px 0",
              minWidth: 36,
              fontSize: 13,
              justifyContent: "center",
            }}
          >
            {p}
          </button>
        ),
      )}

      <button
        onClick={() => onPage(page + 1)}
        disabled={page === totalPages}
        className="btn btn-ghost"
        style={{ padding: "8px 14px", fontSize: 13, gap: 4 }}
      >
        Next <ChevronRight size={14} />
      </button>
    </div>
  );
}

function FilterChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: "5px 12px",
        fontSize: 12.5,
        borderRadius: 20,
        cursor: "pointer",
        border: active ? "none" : "1px solid var(--border)",
        background: active ? "var(--accent)" : "var(--bg-secondary)",
        color: active ? "#fff" : "var(--text-secondary)",
        fontWeight: active ? 600 : 400,
        transition: "all 0.15s",
        whiteSpace: "nowrap",
      }}
    >
      {label}
    </button>
  );
}

export function Dashboard() {
  const { user } = useAuthStore();
  const [scoreFilter, setScoreFilter] = useState<ScoreFilterId>("6plus");
  const [viewMode, setViewMode] = useState<ViewMode>("active");
  const [statusFilter, setStatusFilter] = useState<string | undefined>(undefined);
  const [sourceFilter, setSourceFilter] = useState<string | undefined>(undefined);
  const [page, setPage] = useState(1);
  const [showManual, setShowManual] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [reminderDismissed, setReminderDismissed] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [limitModalKind, setLimitModalKind] = useState<LimitKind | null>(null);

  const openLimitModal = (kind: LimitKind) => setLimitModalKind(kind);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(searchQuery), 400);
    return () => clearTimeout(t);
  }, [searchQuery]);

  const queryClient = useQueryClient();

  const rateMutation = useMutation({
    mutationFn: jobsApi.rateAll,
    onSuccess: (res: any) => {
      queryClient.invalidateQueries({ queryKey: ["crawl-status"] });

      const queued = res?.queued ?? 0;
      const willRate = res?.will_rate_up_to ?? queued;
      const ratingsRemaining = res?.ratings_remaining ?? 0;

      if (queued === 0 || res?.message?.includes("No unrated")) {
        toast("No unrated jobs to rate.", { duration: 3000 });
        return;
      }

      if (willRate <= 0 || ratingsRemaining <= 0) {
        toast.error(
          "Rating limit reached — unrated jobs stay in your list until your quota resets.",
          { duration: 6000 },
        );
        openLimitModal("rating");
        return;
      }

      toast(`Rating up to ${willRate} job${willRate === 1 ? "" : "s"}...`, {
        duration: 4000,
      });
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
      [2000, 4000, 7000, 10000, 15000, 20000, 30000].forEach((delay) => {
        setTimeout(() => queryClient.invalidateQueries({ queryKey: ["jobs"] }), delay);
      });
    },
    onError: (err: any) => {
      const detail = err.response?.data?.detail || "Rating failed";
      if (detail.toLowerCase().includes("limit")) {
        toast.error(detail, { duration: 6000 });
        openLimitModal(parseLimitKindFromDetail(detail));
      } else {
        toast.error(detail);
      }
    },
  });

  const userId = user?.id ?? user?._id ?? "anonymous";
  const activeScoreFilter =
    SCORE_FILTER_OPTS.find((o) => o.id === scoreFilter) ?? SCORE_FILTER_OPTS[0];

  // exclude_terminal = active view + no specific status selected
  const excludeTerminal = viewMode === "active" && !statusFilter;

  const hasActiveFilters =
    scoreFilter !== "6plus" ||
    !!statusFilter ||
    !!sourceFilter ||
    !!debouncedQuery ||
    viewMode !== "active";

  const activeFilterCount = [
    scoreFilter !== "6plus",
    !!statusFilter,
    !!sourceFilter,
    !!debouncedQuery,
  ].filter(Boolean).length;

  const { data, isLoading, refetch } = useQuery({
    queryKey: [
      "jobs",
      userId,
      scoreFilter,
      statusFilter,
      sourceFilter,
      page,
      debouncedQuery,
      viewMode,
    ],
    enabled: !!user,
    queryFn: () =>
      jobsApi.list({
        score_min: activeScoreFilter.score_min,
        score_max: activeScoreFilter.score_max,
        rating: activeScoreFilter.rating,
        status: statusFilter,
        source: sourceFilter,
        page,
        limit: 20,
        q: debouncedQuery || undefined,
        exclude_terminal: excludeTerminal,
      }),
    refetchInterval: 30000,
  });

  const crawlMutation = useMutation({
    mutationFn: crawlerApi.search,
    onSuccess: async (res) => {
      toast.success(`Found ${res.found} jobs, ${res.stored} new`);
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
      queryClient.invalidateQueries({ queryKey: ["kanban"] });
      queryClient.invalidateQueries({ queryKey: ["crawl-status"] });

      if (res.stored <= 0) return;

      try {
        const status = await crawlerApi.status();
        const isFullAccess = !!status.full_access;
        const ratingsLeft = isFullAccess
          ? 999
          : Math.max(0, (status.rating_limit ?? 0) - (status.ratings_used ?? 0));
        const tokensBlocked =
          !status.token_quota_unlimited &&
          (status.daily_token_limit ?? 0) > 0 &&
          (status.daily_tokens_remaining ?? 1) <= 0;

        if (!isFullAccess && (ratingsLeft <= 0 || tokensBlocked)) {
          toast.error(
            tokensBlocked
              ? "AI token limit reached — new jobs saved but not rated. Resets at midnight UTC or contact admin."
              : "Rating limit reached — new jobs saved but not rated. Contact admin or wait for reset.",
            { duration: 6000 },
          );
          openLimitModal(tokensBlocked ? "token_daily" : "rating");
          return;
        }

        const r = await jobsApi.rateAll();
        const willRate = r?.will_rate_up_to ?? r?.queued ?? 0;
        if (willRate > 0) {
          toast(`Rating up to ${willRate} new job${willRate === 1 ? "" : "s"}...`, {
            duration: 3000,
          });
          [2000, 4000, 7000, 10000, 15000, 20000, 30000].forEach((delay) => {
            setTimeout(() => queryClient.invalidateQueries({ queryKey: ["jobs"] }), delay);
          });
        }
      } catch (err: any) {
        const detail = err.response?.data?.detail || "Could not rate new jobs";
        if (detail.toLowerCase().includes("limit")) {
          toast.error(`${detail} New jobs were saved but not rated.`, {
            duration: 6000,
          });
          openLimitModal(parseLimitKindFromDetail(detail));
        } else {
          toast.error(detail);
        }
      }
    },
    onError: (err: any) => {
      const detail = err.response?.data?.detail || "Search failed";
      if (detail.toLowerCase().includes("limit")) {
        toast.error(detail, { duration: 6000 });
        openLimitModal(parseLimitKindFromDetail(detail));
      } else {
        toast.error(detail);
      }
    },
  });

  const statusQ = useQuery({
    queryKey: ["crawl-status"],
    queryFn: crawlerApi.status,
    refetchInterval: 45000,
  });

  const usage = statusQ.data;
  const isFull =
    usage &&
    (usage.full_access ||
      (usage.full_access_until && new Date(usage.full_access_until) > new Date()));
  const ratingsUsed = usage?.ratings_used ?? 0;
  const ratingsLimit = usage?.rating_limit ?? 10;
  const ratingsRemaining = isFull ? 999 : Math.max(0, ratingsLimit - ratingsUsed);
  const isRatingsLimited = !isFull && ratingsUsed >= ratingsLimit;

  const dailyTokensUsed = usage?.daily_tokens_used ?? 0;
  const dailyTokenLimit = usage?.daily_token_limit ?? 0;
  const monthlyTokensUsed = usage?.monthly_tokens_used ?? 0;
  const monthlyTokenLimit = usage?.monthly_token_limit ?? 0;
  const tokensUnlimited =
    isFull || usage?.token_quota_unlimited || (dailyTokenLimit <= 0 && monthlyTokenLimit <= 0);
  const dailyTokensRemaining =
    dailyTokenLimit > 0 ? Math.max(0, dailyTokenLimit - dailyTokensUsed) : null;
  const monthlyTokensRemaining =
    monthlyTokenLimit > 0 ? Math.max(0, monthlyTokenLimit - monthlyTokensUsed) : null;
  const isDailyTokensLimited =
    !tokensUnlimited && dailyTokenLimit > 0 && dailyTokensRemaining === 0;
  const isMonthlyTokensLimited =
    !tokensUnlimited && monthlyTokenLimit > 0 && monthlyTokensRemaining === 0;
  const isTokensLimited = isDailyTokensLimited || isMonthlyTokensLimited;
  const tokenLimitKind: LimitKind = isMonthlyTokensLimited ? "token_monthly" : "token_daily";

  const searchesUsed = usage?.searches_used ?? 0;
  const searchesLimit = usage?.search_limit ?? 5;
  const searchesRemaining = isFull ? 999 : Math.max(0, searchesLimit - searchesUsed);

  const canRate = user?.isAdmin || (ratingsRemaining > 0 && !isTokensLimited);
  const canSearch = user?.isAdmin || (searchesRemaining > 0 && !isTokensLimited);

  const jobs = data?.jobs ?? [];
  const totalPages = data?.pages ?? 1;

  const highScoreUnapplied = jobs.filter((j) => (j.score ?? 0) >= 8 && j.status === "NEW");
  const showReminder = !reminderDismissed && highScoreUnapplied.length >= 2;

  const strongOnPage = jobs.filter((j) => (j.score ?? 0) >= 7).length;
  const appliedOnPage = jobs.filter((j) => j.status === "APPLIED").length;
  const searchUsedPct = isFull ? 0 : Math.round((searchesUsed / Math.max(searchesLimit, 1)) * 100);
  const ratingUsedPct = isFull ? 0 : Math.round((ratingsUsed / Math.max(ratingsLimit, 1)) * 100);
  const tokenUsedPct =
    dailyTokenLimit > 0 ? Math.round((dailyTokensUsed / dailyTokenLimit) * 100) : 0;

  const handleStatusFilter = (val: string | undefined) => {
    setStatusFilter(val);
    // when picking a specific terminal status, switch to "all" view so it shows
    if (val === "APPLIED" || val === "REJECTED" || val === "OFFER") {
      setViewMode("all");
    }
    setPage(1);
  };

  const clearAllFilters = () => {
    setScoreFilter("6plus");
    setStatusFilter(undefined);
    setSourceFilter(undefined);
    setSearchQuery("");
    setViewMode("active");
    setPage(1);
  };

  return (
    <div className="page-shell">
      <div className="dash-header">
        <h1 className="page-title">Jobs</h1>
        <p className="page-subtitle">
          {viewMode === "active"
            ? "Active opportunities — Applied, Rejected, and Offers are hidden. Switch to All to see them."
            : "All your saved jobs — filter by score, status, or keyword."}
        </p>
      </div>

      {data && (
        <div className="dash-metrics">
          <div className="dash-metric">
            <span className="dash-metric-label">
              {hasActiveFilters
                ? "Matching filters"
                : viewMode === "active"
                  ? "Active jobs"
                  : "Total saved"}
            </span>
            <span className="dash-metric-value">{data.total}</span>
            <span className="dash-metric-hint">
              {data.account_total != null ? `of ${data.account_total} in account` : "All time"}
            </span>
          </div>
          <div className="dash-metric">
            <span className="dash-metric-label">Strong on page</span>
            <span className="dash-metric-value is-success">{strongOnPage}</span>
            <span className="dash-metric-hint">Score 7+ in view</span>
          </div>
          <div className="dash-metric">
            <span className="dash-metric-label">Apply soon</span>
            <span
              className={`dash-metric-value${highScoreUnapplied.length > 0 ? " is-warning" : ""}`}
            >
              {highScoreUnapplied.length}
            </span>
            <span className="dash-metric-hint">8+ still marked New</span>
          </div>
          <div className="dash-metric">
            <span className="dash-metric-label">Applied on page</span>
            <span className="dash-metric-value">{appliedOnPage}</span>
            <span className="dash-metric-hint">In your pipeline</span>
          </div>
        </div>
      )}

      {usage && !user?.isAdmin && (
        <div className="dash-usage">
          <div className="dash-usage-grid">
            <div
              className={`dash-usage-item${searchesRemaining <= 1 && !isFull ? " is-warn" : ""}`}
            >
              <div className="dash-usage-label">
                <Search size={12} /> Searches
              </div>
              <div className="dash-usage-value">
                {isFull ? "Unlimited" : `${searchesRemaining} left`}
              </div>
              {!isFull && (
                <div className="dash-usage-bar">
                  <span style={{ width: `${Math.min(100, searchUsedPct)}%` }} />
                </div>
              )}
            </div>

            <div
              className={`dash-usage-item${
                isRatingsLimited ? " is-limit" : ratingsRemaining <= 2 && !isFull ? " is-warn" : ""
              }`}
            >
              <div className="dash-usage-label">
                <Zap size={12} /> Ratings
              </div>
              <div className="dash-usage-value">
                {isFull ? "Unlimited" : `${ratingsRemaining} left`}
              </div>
              {!isFull && (
                <div className="dash-usage-bar">
                  <span style={{ width: `${Math.min(100, ratingUsedPct)}%` }} />
                </div>
              )}
              {isRatingsLimited && (
                <button
                  onClick={() => openLimitModal("rating")}
                  className="btn btn-danger"
                  style={{
                    marginTop: 8,
                    width: "100%",
                    justifyContent: "center",
                    fontSize: 11,
                    padding: "4px 8px",
                  }}
                >
                  Request more
                </button>
              )}
            </div>

            {!tokensUnlimited && dailyTokenLimit > 0 && (
              <div
                className={`dash-usage-item${
                  isTokensLimited
                    ? " is-limit"
                    : (dailyTokensRemaining ?? 0) <= dailyTokenLimit * 0.2
                      ? " is-warn"
                      : ""
                }`}
              >
                <div className="dash-usage-label">
                  <Cpu size={12} /> AI tokens today
                </div>
                <div className="dash-usage-value">
                  {formatTokens(dailyTokensUsed)} / {formatTokens(dailyTokenLimit)}
                </div>
                <div className="dash-usage-bar">
                  <span style={{ width: `${Math.min(100, tokenUsedPct)}%` }} />
                </div>
                {isTokensLimited && (
                  <button
                    onClick={() => openLimitModal(tokenLimitKind)}
                    className="btn btn-danger"
                    style={{
                      marginTop: 8,
                      width: "100%",
                      justifyContent: "center",
                      fontSize: 11,
                      padding: "4px 8px",
                    }}
                  >
                    Request more
                  </button>
                )}
              </div>
            )}
          </div>

          {isRatingsLimited && !isFull && !isTokensLimited && (
            <div
              onClick={() => openLimitModal("rating")}
              style={{
                marginTop: 10,
                fontSize: 11,
                color: "var(--danger)",
                display: "flex",
                alignItems: "center",
                gap: 5,
                cursor: "pointer",
              }}
            >
              <AlertCircle size={12} /> Rating limit reached — click to request more access
            </div>
          )}

          {isTokensLimited && !isFull && (
            <div
              onClick={() => openLimitModal(tokenLimitKind)}
              style={{
                marginTop: 10,
                fontSize: 11,
                color: "var(--danger)",
                display: "flex",
                alignItems: "center",
                gap: 5,
                cursor: "pointer",
              }}
            >
              <AlertCircle size={12} />
              {isMonthlyTokensLimited
                ? "Monthly AI limit reached — resets on the 1st, or contact admin for credits"
                : "Daily AI limit reached — resets at midnight UTC, or contact admin for credits"}
            </div>
          )}
        </div>
      )}

      {showReminder && (
        <div className="dash-reminder">
          <AlertCircle size={18} style={{ color: "var(--warning)", flexShrink: 0 }} />
          <p className="dash-reminder-text">
            <strong>Hey!</strong> {highScoreUnapplied.length} jobs scoring 8+/10 are sitting
            unapplied. Don&apos;t let good opportunities slip by.
          </p>
          <div className="dash-reminder-actions">
            <button
              onClick={() => {
                setScoreFilter("8plus");
                setStatusFilter("NEW");
                setViewMode("all");
                setPage(1);
              }}
              className="btn btn-secondary"
              style={{ fontSize: 13, padding: "6px 12px", flexShrink: 0 }}
            >
              View them
            </button>
            <button
              onClick={() => setReminderDismissed(true)}
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                color: "var(--text-muted)",
                display: "flex",
              }}
            >
              <X size={15} />
            </button>
          </div>
        </div>
      )}

      {/* Toolbar */}
      <div className="dash-toolbar">
        <button onClick={() => setShowManual(true)} className="btn btn-ghost">
          <Plus size={14} /> Paste JD
        </button>

        <button
          onClick={() => {
            if (!canSearch) {
              openLimitModal(isTokensLimited ? tokenLimitKind : "search");
              return;
            }
            crawlMutation.mutate();
          }}
          disabled={crawlMutation.isPending}
          className="btn btn-primary"
        >
          <Search size={14} />
          {crawlMutation.isPending
            ? "Searching..."
            : isFull
              ? "Search jobs"
              : `Search jobs (${searchesRemaining} left)`}
        </button>

        <button
          onClick={() => {
            if (!canRate) {
              openLimitModal(isTokensLimited ? tokenLimitKind : "rating");
              return;
            }
            rateMutation.mutate();
          }}
          disabled={rateMutation.isPending}
          className="btn btn-secondary"
          style={!canRate ? { opacity: 0.6 } : {}}
        >
          {rateMutation.isPending ? (
            <>
              <Loader size={14} className="animate-spin" /> Rating...
            </>
          ) : canRate ? (
            <>{isFull ? "Rate now" : `Rate now (${ratingsRemaining} left)`}</>
          ) : isTokensLimited ? (
            <>AI limit reached</>
          ) : (
            <>Rate limit reached</>
          )}
        </button>

        <input
          type="text"
          placeholder="Search saved jobs..."
          value={searchQuery}
          onChange={(e) => {
            setSearchQuery(e.target.value);
            setPage(1);
          }}
          className="input"
          style={{ maxWidth: 220 }}
        />

        <div style={{ flex: 1 }} />

        <button onClick={() => setShowFilters(!showFilters)} className="btn btn-ghost">
          <SlidersHorizontal size={13} />
          Filters
          {activeFilterCount > 0 && (
            <span
              style={{
                background: "var(--accent)",
                color: "#fff",
                borderRadius: "50%",
                width: 17,
                height: 17,
                fontSize: 10,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              {activeFilterCount}
            </span>
          )}
        </button>

        <button onClick={() => refetch()} className="btn btn-ghost" style={{ padding: "9px 11px" }}>
          <RefreshCw size={14} />
        </button>
      </div>

      {/* Always-visible filter bar: score chips + Active/All toggle — two rows so mobile never overlaps */}
      <div
        style={{
          marginBottom: 14,
          paddingBottom: 14,
          borderBottom: "1px solid var(--border)",
        }}
      >
        {/* Row 1: score chips */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            flexWrap: "wrap",
            marginBottom: 10,
          }}
        >
          <span
            style={{
              fontSize: 11.5,
              color: "var(--text-muted)",
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: "0.05em",
              whiteSpace: "nowrap",
            }}
          >
            Score
          </span>
          {SCORE_FILTER_OPTS.map((o) => (
            <FilterChip
              key={o.id}
              label={o.label}
              active={scoreFilter === o.id}
              onClick={() => {
                setScoreFilter(o.id);
                setPage(1);
              }}
            />
          ))}
        </div>

        {/* Row 2: view mode toggle — always on its own line, right-aligned */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "flex-end",
          }}
        >
          <span style={{ fontSize: 12, color: "var(--text-muted)", marginRight: 8 }}>Show:</span>
          <div
            style={{
              display: "flex",
              gap: 2,
              background: "var(--bg-secondary)",
              borderRadius: 20,
              padding: 3,
              border: "1px solid var(--border)",
            }}
          >
            <button
              onClick={() => {
                setViewMode("active");
                setStatusFilter(undefined);
                setPage(1);
              }}
              style={{
                padding: "4px 14px",
                borderRadius: 20,
                border: "none",
                fontSize: 12,
                cursor: "pointer",
                background: viewMode === "active" ? "var(--bg-card)" : "transparent",
                color: viewMode === "active" ? "var(--text)" : "var(--text-muted)",
                fontWeight: viewMode === "active" ? 600 : 400,
                boxShadow: viewMode === "active" ? "var(--shadow-sm)" : "none",
                transition: "all 0.15s",
              }}
            >
              Active
            </button>
            <button
              onClick={() => {
                setViewMode("all");
                setPage(1);
              }}
              style={{
                padding: "4px 14px",
                borderRadius: 20,
                border: "none",
                fontSize: 12,
                cursor: "pointer",
                background: viewMode === "all" ? "var(--bg-card)" : "transparent",
                color: viewMode === "all" ? "var(--text)" : "var(--text-muted)",
                fontWeight: viewMode === "all" ? 600 : 400,
                boxShadow: viewMode === "all" ? "var(--shadow-sm)" : "none",
                transition: "all 0.15s",
              }}
            >
              All
            </button>
          </div>
        </div>
      </div>

      {/* Expandable filter panel — status + source */}
      {showFilters && (
        <div
          className="card"
          style={{
            padding: 16,
            marginBottom: 18,
            display: "flex",
            flexDirection: "column",
            gap: 16,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
              flexWrap: "wrap",
            }}
          >
            <p style={{ margin: 0, fontSize: 13, color: "var(--text-muted)" }}>
              Advanced filters — applied on top of score and view mode above.
            </p>
            {hasActiveFilters && (
              <button
                onClick={clearAllFilters}
                className="btn btn-ghost"
                style={{ fontSize: 12, padding: "6px 10px" }}
              >
                Clear all
              </button>
            )}
          </div>

          <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
            <div>
              <p className="label" style={{ marginBottom: 8 }}>
                Status
              </p>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {STATUS_OPTS.map((o) => (
                  <FilterChip
                    key={o.label}
                    label={o.label}
                    active={statusFilter === o.value}
                    onClick={() => handleStatusFilter(o.value)}
                  />
                ))}
              </div>
            </div>

            <div>
              <p className="label" style={{ marginBottom: 8 }}>
                Source
              </p>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {SOURCE_OPTS.map((o) => (
                  <FilterChip
                    key={o.label}
                    label={o.label}
                    active={sourceFilter === o.value}
                    onClick={() => {
                      setSourceFilter(o.value);
                      setPage(1);
                    }}
                  />
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {isLoading ? (
        <div
          style={{
            textAlign: "center",
            padding: "80px 0",
            color: "var(--text-muted)",
            fontSize: 14,
          }}
        >
          Loading jobs...
        </div>
      ) : jobs.length === 0 ? (
        <div style={{ textAlign: "center", padding: "80px 0" }}>
          <p
            style={{
              color: "var(--text-muted)",
              fontSize: 15,
              marginBottom: 18,
            }}
          >
            {hasActiveFilters
              ? viewMode === "active"
                ? "No active jobs match these filters. Try switching to All to include Applied and Rejected, or clear filters."
                : "No jobs match your current filters. Try clearing filters or broadening the score range."
              : "No jobs found. Search to discover new roles."}
          </p>
          {!hasActiveFilters ? (
            <button onClick={() => crawlMutation.mutate()} className="btn btn-primary">
              <Search size={14} /> Search for jobs
            </button>
          ) : (
            <div
              style={{
                display: "flex",
                gap: 8,
                justifyContent: "center",
                flexWrap: "wrap",
              }}
            >
              {viewMode === "active" && (
                <button
                  onClick={() => {
                    setViewMode("all");
                    setPage(1);
                  }}
                  className="btn btn-secondary"
                >
                  Show all (including Applied/Rejected)
                </button>
              )}
              <button onClick={clearAllFilters} className="btn btn-ghost">
                Clear filters
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="jobs-grid">
          {jobs.map((job) => (
            <JobCard
              key={job.id}
              job={job}
              onStatusChange={() => {
                queryClient.invalidateQueries({ queryKey: ["jobs"] });
                queryClient.invalidateQueries({ queryKey: ["kanban"] });
              }}
              onHidden={() => queryClient.invalidateQueries({ queryKey: ["jobs"] })}
            />
          ))}
        </div>
      )}

      {totalPages > 1 && <Pagination page={page} totalPages={totalPages} onPage={setPage} />}

      {showManual && (
        <ManualJDModal
          canRate={canRate}
          ratingsRemaining={ratingsRemaining}
          onLimitReached={openLimitModal}
          onClose={() => setShowManual(false)}
          onAdded={() => {
            queryClient.invalidateQueries({ queryKey: ["jobs"] });
            queryClient.invalidateQueries({ queryKey: ["crawl-status"] });
          }}
        />
      )}

      {limitModalKind && (
        <LimitContactModal kind={limitModalKind} onClose={() => setLimitModalKind(null)} />
      )}
    </div>
  );
}
