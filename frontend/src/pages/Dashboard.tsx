import { useState, useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Search,
  Plus,
  RefreshCw,
  SlidersHorizontal,
  AlertCircle,
  X,
  Loader,
  ChevronLeft,
  ChevronRight,
  Briefcase,
} from "lucide-react";
import toast from "react-hot-toast";
import { JobCard } from "../components/JobCard";
import { ManualJDModal } from "../components/ManualJDModal";
import { StatTile } from "../components/StatTile";
import {
  LimitContactModal,
  parseLimitKindFromDetail,
  type LimitKind,
} from "../components/LimitContactModal";
import { jobsApi, crawlerApi, cvApi, userApi } from "../api/index";
import { useAuthStore } from "../hooks/useStores";
import { getMissingProfileFields } from "../utils/profileCompleteness";

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
    hint: "Score 6-10",
    score_min: 6,
    score_max: 10,
    rating: "rated",
  },
  {
    id: "7plus",
    label: "7+",
    hint: "Score 7-10, strong matches",
    score_min: 7,
    score_max: 10,
    rating: "rated",
  },
  {
    id: "8plus",
    label: "8+",
    hint: "Score 8-10, top picks",
    score_min: 8,
    score_max: 10,
    rating: "rated",
  },
  {
    id: "below6",
    label: "Below 6",
    hint: "Score 1-5",
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
  { label: "LinkedIn", value: "jobsapi-linkedin" },
  { label: "Manual", value: "manual" },
];

function formatTokens(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(0)}k`;
  return String(n);
}

function timeGreeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

function formatLastCrawl(iso?: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  const diffH = (Date.now() - d.getTime()) / 36e5;
  if (diffH < 1) return "Last search: just now";
  if (diffH < 24) return `Last search: ${Math.floor(diffH)}h ago`;
  const diffD = Math.floor(diffH / 24);
  return `Last search: ${diffD}d ago`;
}

function JobsSkeleton() {
  return (
    <div className="jobs-grid">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="dash-skeleton-card" aria-hidden="true">
          <div className="dash-skeleton-line w-30" />
          <div className="dash-skeleton-line w-80" />
          <div className="dash-skeleton-line w-55" />
          <div className="dash-skeleton-line w-100" />
        </div>
      ))}
    </div>
  );
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
        gap: "var(--space-1)",
        marginTop: "var(--space-7)",
        flexWrap: "wrap",
      }}
    >
      <button
        onClick={() => onPage(page - 1)}
        disabled={page === 1}
        className="btn btn-ghost"
        style={{
          padding: "var(--space-2) var(--space-4)",
          fontSize: "var(--text-sm)",
          gap: "var(--space-1)",
        }}
      >
        <ChevronLeft size={14} /> Prev
      </button>

      {pages.map((p, i) =>
        p === "…" ? (
          <span
            key={`e${i}`}
            style={{
              padding: "var(--space-2)",
              color: "var(--text-muted)",
              fontSize: "var(--text-sm)",
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
              padding: "var(--space-2) 0",
              minWidth: 36,
              fontSize: "var(--text-sm)",
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
        style={{
          padding: "var(--space-2) var(--space-4)",
          fontSize: "var(--text-sm)",
          gap: "var(--space-1)",
        }}
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
        padding: "var(--space-2) var(--space-3)",
        fontSize: "var(--text-xs)",
        borderRadius: "var(--radius-pill)",
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
  const [isCrawling, setIsCrawling] = useState(false);
  const [scoreFilter, setScoreFilter] = useState<ScoreFilterId>("6plus");
  const [viewMode, setViewMode] = useState<ViewMode>("active");
  const [statusFilter, setStatusFilter] = useState<string | undefined>(undefined);
  const [sourceFilter, setSourceFilter] = useState<string | undefined>(undefined);
  const [page, setPage] = useState(1);
  const [showManual, setShowManual] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const navigate = useNavigate();
  const location = useLocation();
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [jobIdFilter, setJobIdFilter] = useState<string | undefined>(undefined);
  const [limitModalKind, setLimitModalKind] = useState<LimitKind | null>(null);

  const openLimitModal = (kind: LimitKind) => setLimitModalKind(kind);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(searchQuery), 1000);
    return () => clearTimeout(t);
  }, [searchQuery]);

  // Deep link from elsewhere (e.g. the "CVs you've built" dropdown), jump
  // straight to that exact job by id instead of opening a detail modal out
  // of context, so it renders through the normal card + filter flow. Keyed
  // on location.search (not []) so it fires even when already on this page.
  useEffect(() => {
    const id = new URLSearchParams(location.search).get("job_id");
    if (!id) return;
    setJobIdFilter(id);
    setPage(1);
    navigate("/", { replace: true });
  }, [location.search, navigate]);

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
          "Rating limit reached. Unrated jobs stay in your list until your quota resets.",
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
      jobIdFilter,
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
        job_id: jobIdFilter,
      }),
    refetchInterval: 30000,
  });

  const crawlMutation = useMutation({
    mutationFn: async () => {
      if (isCrawling) throw new Error("already_crawling");
      setIsCrawling(true);
      return crawlerApi.search();
    },
    onSuccess: async (res) => {
      toast.success(`Found ${res.found} jobs, ${res.stored} new`);
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
      queryClient.invalidateQueries({ queryKey: ["kanban"] });
      queryClient.invalidateQueries({ queryKey: ["crawl-status"] });

      if (res.stored <= 0) return;

      try {
        const status = await crawlerApi.status();
        const isFullAccess = !!(
          user?.isAdmin ||
          status.is_admin ||
          status.token_quota_unlimited ||
          status.full_access ||
          (status.full_access_until && new Date(status.full_access_until) > new Date())
        );
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
              ? "AI token limit reached. New jobs saved but not rated. Resets at midnight local time or contact admin."
              : "Rating limit reached. New jobs saved but not rated. Contact admin or wait for reset.",
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
      setIsCrawling(false);
    },
    onError: (err: any) => {
      if (err.message === "already_crawling") return;
      setIsCrawling(false);
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

  // 404 (no CV uploaded yet) is a valid, expected state here, don't retry it.
  const cvQ = useQuery({ queryKey: ["cv"], queryFn: cvApi.get, retry: false });
  const prefsQ = useQuery({ queryKey: ["preferences"], queryFn: userApi.getPreferences });
  const prefs = prefsQ.data;

  const missingProfileFields = getMissingProfileFields(cvQ.data, prefs);
  // Preferences + CV queries haven't resolved yet, don't block the button on a false "missing" read.
  const profileCheckReady = prefsQ.isSuccess && (cvQ.isSuccess || cvQ.isError);
  const hasRequiredProfile = !profileCheckReady || missingProfileFields.length === 0;

  const requireCompleteProfile = () => {
    if (hasRequiredProfile) return true;
    toast.error(
      `Complete your profile before searching: ${missingProfileFields.map((f) => f.label).join(", ")}.`,
      { duration: 6000 },
    );
    navigate("/settings");
    return false;
  };

  const usage = statusQ.data;
  const isFull = !!(
    user?.isAdmin ||
    usage?.is_admin ||
    usage?.token_quota_unlimited ||
    usage?.full_access ||
    (usage?.full_access_until && new Date(usage.full_access_until) > new Date())
  );
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

  const applySoonCount = usage?.apply_soon_count ?? 0;
  const strongMatchesCount = usage?.strong_matches_count ?? 0;
  const unratedCount = usage?.unrated_count ?? 0;
  const activeAccountCount = usage?.active_count ?? data?.account_total ?? 0;
  const lastCrawlLabel = formatLastCrawl(usage?.last_crawl_at);
  const firstName = user?.name?.trim().split(/\s+/)[0] || "there";

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

  const showApplySoon = () => {
    setScoreFilter("8plus");
    setStatusFilter("NEW");
    setViewMode("all");
    setPage(1);
  };

  const showUnrated = () => {
    setScoreFilter("unrated");
    setStatusFilter(undefined);
    setViewMode("all");
    setPage(1);
  };

  const showStrongMatches = () => {
    setScoreFilter("7plus");
    setStatusFilter(undefined);
    setViewMode("active");
    setPage(1);
  };

  const packsUsed = usage?.apply_packs_used ?? 0;
  const packsLimit = usage?.apply_pack_limit ?? 0;
  const packsRemaining = isFull
    ? 999
    : Math.max(0, (usage?.apply_packs_remaining ?? packsLimit - packsUsed) || 0);
  const packsUnlimited = isFull || packsLimit >= 9999;
  const dailyTokensLeft = dailyTokensRemaining ?? 0;
  const searchesNearLimit = !isFull && searchesRemaining <= 1;
  const ratingsNearLimit = !isFull && (isRatingsLimited || ratingsRemaining <= 2);
  const tokensNearLimit =
    !tokensUnlimited &&
    dailyTokenLimit > 0 &&
    (isTokensLimited || dailyTokensLeft <= dailyTokenLimit * 0.2);
  const packsNearLimit = !packsUnlimited && packsRemaining <= 1;
  const showLimitWarning =
    !!usage &&
    !user?.isAdmin &&
    !isFull &&
    (searchesNearLimit || ratingsNearLimit || tokensNearLimit || packsNearLimit);

  return (
    <div className="page-shell dash-page">
      <div className="dash-hero">
        <div className="dash-header">
          <p className="dash-greeting">
            {timeGreeting()}, {firstName}
          </p>
          <h1 className="page-title text-display">Your jobs</h1>
          <p className="page-subtitle">
            {viewMode === "active"
              ? "Active opportunities. Applied and rejected stay in Track unless you show All."
              : "Everything you have saved. Filter by score, status, or keyword."}
            {lastCrawlLabel && <span className="dash-last-crawl"> · {lastCrawlLabel}</span>}
          </p>
        </div>

        {usage && (
          <div className="dash-metrics">
            <StatTile
              label={hasActiveFilters ? "Matching" : "Active"}
              value={hasActiveFilters ? (data?.total ?? "-") : activeAccountCount}
              hint={
                hasActiveFilters
                  ? `of ${activeAccountCount} active`
                  : `${usage.my_jobs ?? 0} total saved`
              }
            />
            <StatTile
              label="Strong matches"
              value={strongMatchesCount}
              hint="Score 7+ · tap to filter"
              tone="success"
              onClick={showStrongMatches}
            />
            <StatTile
              label="Apply soon"
              value={applySoonCount}
              hint="8+ still New · tap to view"
              tone={applySoonCount > 0 ? "warning" : undefined}
              highlight={applySoonCount > 0}
              onClick={showApplySoon}
            />
            <StatTile
              label="Needs rating"
              value={unratedCount}
              hint="Waiting for AI · tap to filter"
              tone={unratedCount > 0 ? "accent" : undefined}
              onClick={showUnrated}
            />
          </div>
        )}

        {applySoonCount > 0 && (
          <div className="dash-apply-banner" role="status">
            <div className="dash-apply-banner-copy">
              <strong>Apply soon</strong>
              <span>
                {applySoonCount} role{applySoonCount === 1 ? "" : "s"} scoring 8+ still marked New
              </span>
            </div>
            <button type="button" className="btn btn-primary" onClick={showApplySoon}>
              View top matches
            </button>
          </div>
        )}
      </div>

      {showLimitWarning && (
        <div
          className={`dash-limit-warning${isRatingsLimited || isTokensLimited || packsRemaining <= 0 ? " is-limit" : ""}`}
          role="status"
        >
          <AlertCircle size={14} />
          <div className="dash-limit-warning-copy">
            <strong>Running low</strong>
            <span>
              {[
                searchesNearLimit
                  ? `${searchesRemaining} search${searchesRemaining === 1 ? "" : "es"} left`
                  : null,
                ratingsNearLimit
                  ? `${ratingsRemaining} rating${ratingsRemaining === 1 ? "" : "s"} left`
                  : null,
                tokensNearLimit
                  ? isTokensLimited
                    ? "AI tokens used up"
                    : `${formatTokens(dailyTokensLeft)} AI tokens left`
                  : null,
                packsNearLimit
                  ? `${packsRemaining} CV pack${packsRemaining === 1 ? "" : "s"} left`
                  : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </span>
          </div>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() =>
              openLimitModal(
                isTokensLimited || tokensNearLimit
                  ? tokenLimitKind
                  : isRatingsLimited || ratingsNearLimit
                    ? "rating"
                    : packsNearLimit
                      ? "apply_pack"
                      : "search",
              )
            }
          >
            Request more
          </button>
        </div>
      )}

      {/* Toolbar */}
      <div className="dash-toolbar">
        <button onClick={() => setShowManual(true)} className="btn btn-ghost">
          <Plus size={14} /> Paste JD
        </button>

        <button
          onClick={() => {
            if (!requireCompleteProfile()) return;
            if (!canSearch) {
              openLimitModal(isTokensLimited ? tokenLimitKind : "search");
              return;
            }
            crawlMutation.mutate();
          }}
          disabled={isCrawling}
          className="btn btn-primary"
        >
          <Search size={14} />
          {isCrawling
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
          placeholder="Search title, company, location, or JD keyword..."
          title="Search narrows within the score/status filters below, set them first, then search"
          value={searchQuery}
          onChange={(e) => {
            setSearchQuery(e.target.value);
            setJobIdFilter(undefined);
            setPage(1);
          }}
          className="input dash-search-input"
        />

        <div className="dash-toolbar-spacer" />

        <button onClick={() => setShowFilters(!showFilters)} className="btn btn-ghost">
          <SlidersHorizontal size={13} />
          Filters
          {activeFilterCount > 0 && (
            <span
              style={{
                background: "var(--accent)",
                color: "#fff",
                borderRadius: "50%",
                width: 18,
                height: 18,
                fontSize: "var(--text-xs)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              {activeFilterCount}
            </span>
          )}
        </button>

        <button
          onClick={() => refetch()}
          className="btn btn-ghost"
          style={{ padding: "var(--space-2) var(--space-3)" }}
        >
          <RefreshCw size={14} />
        </button>
      </div>

      {/* Always-visible filter bar: score chips + Active/All toggle, two rows so mobile never overlaps */}
      <div
        style={{
          marginBottom: "var(--space-4)",
          paddingBottom: "var(--space-4)",
          borderBottom: "1px solid var(--border)",
        }}
      >
        {/* Row 1: score chips */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "var(--space-2)",
            flexWrap: "wrap",
            marginBottom: "var(--space-3)",
          }}
        >
          <span
            style={{
              fontSize: "var(--text-xs)",
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
                setJobIdFilter(undefined);
                setPage(1);
              }}
            />
          ))}
        </div>

        {/* Row 2: view mode toggle, always on its own line, right-aligned */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "flex-end",
          }}
        >
          <span
            style={{
              fontSize: "var(--text-xs)",
              color: "var(--text-muted)",
              marginRight: "var(--space-2)",
            }}
          >
            Show:
          </span>
          <div
            style={{
              display: "flex",
              gap: "var(--space-1)",
              background: "var(--bg-secondary)",
              borderRadius: "var(--radius-pill)",
              padding: "var(--space-1)",
              border: "1px solid var(--border)",
            }}
          >
            <button
              onClick={() => {
                setViewMode("active");
                setStatusFilter(undefined);
                setJobIdFilter(undefined);
                setPage(1);
              }}
              style={{
                padding: "var(--space-1) var(--space-4)",
                borderRadius: "var(--radius-pill)",
                border: "none",
                fontSize: "var(--text-xs)",
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
                setJobIdFilter(undefined);
                setPage(1);
              }}
              style={{
                padding: "var(--space-1) var(--space-4)",
                borderRadius: "var(--radius-pill)",
                border: "none",
                fontSize: "var(--text-xs)",
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

      {/* Expandable filter panel, status + source */}
      {showFilters && (
        <div
          className="card"
          style={{
            padding: "var(--space-4)",
            marginBottom: "var(--space-5)",
            display: "flex",
            flexDirection: "column",
            gap: "var(--space-4)",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "var(--space-3)",
              flexWrap: "wrap",
            }}
          >
            <p style={{ margin: 0, fontSize: "var(--text-sm)", color: "var(--text-muted)" }}>
              Advanced filters, applied on top of score and view mode above.
            </p>
            {hasActiveFilters && (
              <button
                onClick={clearAllFilters}
                className="btn btn-ghost"
                style={{ fontSize: "var(--text-xs)", padding: "var(--space-2) var(--space-3)" }}
              >
                Clear all
              </button>
            )}
          </div>

          <div style={{ display: "flex", gap: "var(--space-5)", flexWrap: "wrap" }}>
            <div>
              <p className="label" style={{ marginBottom: "var(--space-2)" }}>
                Status
              </p>
              <div style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap" }}>
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
              <p className="label" style={{ marginBottom: "var(--space-2)" }}>
                Source
              </p>
              <div style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap" }}>
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
        <JobsSkeleton />
      ) : jobs.length === 0 ? (
        <div className="dash-empty">
          <div className="dash-empty-icon">
            {hasActiveFilters ? <SlidersHorizontal size={28} /> : <Briefcase size={28} />}
          </div>
          <h2 className="dash-empty-title">
            {hasActiveFilters ? "No jobs match these filters" : "Your pipeline is empty"}
          </h2>
          <p className="dash-empty-text">
            {hasActiveFilters
              ? viewMode === "active"
                ? "Try switching to All to include applied and rejected roles, or clear filters."
                : "Broaden the score range or clear filters to see more roles."
              : "Run a search to crawl Indeed and Jooble against your CV, then rate matches with AI."}
          </p>
          {!hasActiveFilters ? (
            <button
              onClick={() => {
                if (!requireCompleteProfile()) return;
                if (!canSearch) {
                  openLimitModal(isTokensLimited ? tokenLimitKind : "search");
                  return;
                }
                if (!isCrawling) crawlMutation.mutate();
              }}
              disabled={isCrawling}
              className="btn btn-primary"
            >
              <Search size={14} /> {isCrawling ? "Searching..." : "Search for jobs"}
            </button>
          ) : (
            <div
              style={{
                display: "flex",
                gap: "var(--space-2)",
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
