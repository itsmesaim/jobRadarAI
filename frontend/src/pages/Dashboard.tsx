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

const SCORE_OPTS = [
  { label: "Show all (incl. <6)", min: 0 },
  { label: "6+ (default)", min: 6 },
  { label: "7+ only", min: 7 },
  { label: "8+ only", min: 8 },
];

const STATUS_OPTS: { label: string; value: string | undefined }[] = [
  { label: "All", value: undefined },
  { label: "New", value: "NEW" },
  { label: "Saved", value: "SAVED" },
  { label: "Applied", value: "APPLIED" },
  { label: "Interviewing", value: "INTERVIEWING" },
  { label: "Offer", value: "OFFER" },
  { label: "Rejected", value: "REJECTED" },
];

function formatTokens(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(0)}k`;
  return String(n);
}

export function Dashboard() {
  const { user } = useAuthStore();
  const [scoreMin, setScoreMin] = useState(6);
  const [statusFilter, setStatusFilter] = useState<string | undefined>(
    undefined,
  );
  const [page, setPage] = useState(1);
  const [showManual, setShowManual] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [reminderDismissed, setReminderDismissed] = useState(false);

  // search-within-list state
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
      const intervals = [2000, 4000, 7000, 10000, 15000, 20000, 30000];
      intervals.forEach((delay) => {
        setTimeout(() => {
          queryClient.invalidateQueries({ queryKey: ["jobs"] });
        }, delay);
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

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["jobs", scoreMin, statusFilter, page, debouncedQuery],
    queryFn: () =>
      jobsApi.list({
        score_min: scoreMin,
        status: statusFilter,
        page,
        limit: 20,
        q: debouncedQuery || undefined,
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
          : Math.max(
              0,
              (status.rating_limit ?? 0) - (status.ratings_used ?? 0),
            );
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
          toast(
            `Rating up to ${willRate} new job${willRate === 1 ? "" : "s"}...`,
            { duration: 3000 },
          );
          const intervals = [2000, 4000, 7000, 10000, 15000, 20000, 30000];
          intervals.forEach((delay) => {
            setTimeout(() => {
              queryClient.invalidateQueries({ queryKey: ["jobs"] });
            }, delay);
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
      (usage.full_access_until &&
        new Date(usage.full_access_until) > new Date()));
  const ratingsUsed = usage?.ratings_used ?? 0;
  const ratingsLimit = usage?.rating_limit ?? 10;
  const ratingsRemaining = isFull
    ? 999
    : Math.max(0, ratingsLimit - ratingsUsed);
  const isRatingsLimited = !isFull && ratingsUsed >= ratingsLimit;

  const dailyTokensUsed = usage?.daily_tokens_used ?? 0;
  const dailyTokenLimit = usage?.daily_token_limit ?? 0;
  const monthlyTokensUsed = usage?.monthly_tokens_used ?? 0;
  const monthlyTokenLimit = usage?.monthly_token_limit ?? 0;
  const tokensUnlimited =
    isFull ||
    usage?.token_quota_unlimited ||
    (dailyTokenLimit <= 0 && monthlyTokenLimit <= 0);
  const dailyTokensRemaining =
    dailyTokenLimit > 0 ? Math.max(0, dailyTokenLimit - dailyTokensUsed) : null;
  const monthlyTokensRemaining =
    monthlyTokenLimit > 0
      ? Math.max(0, monthlyTokenLimit - monthlyTokensUsed)
      : null;
  const isDailyTokensLimited =
    !tokensUnlimited && dailyTokenLimit > 0 && dailyTokensRemaining === 0;
  const isMonthlyTokensLimited =
    !tokensUnlimited && monthlyTokenLimit > 0 && monthlyTokensRemaining === 0;
  const isTokensLimited = isDailyTokensLimited || isMonthlyTokensLimited;
  const tokenLimitKind: LimitKind = isMonthlyTokensLimited
    ? "token_monthly"
    : "token_daily";

  const searchesUsed = usage?.searches_used ?? 0;
  const searchesLimit = usage?.search_limit ?? 5;
  const searchesRemaining = isFull
    ? 999
    : Math.max(0, searchesLimit - searchesUsed);

  const canRate = user?.isAdmin || (ratingsRemaining > 0 && !isTokensLimited);
  const canSearch =
    user?.isAdmin || (searchesRemaining > 0 && !isTokensLimited);

  const jobs = data?.jobs ?? [];
  const totalPages = data?.pages ?? 1;

  const highScoreUnaplied = jobs.filter(
    (j) => (j.score ?? 0) >= 8 && j.status === "NEW",
  );
  const showReminder = !reminderDismissed && highScoreUnaplied.length >= 2;

  const strongOnPage = jobs.filter((j) => (j.score ?? 0) >= 7).length;
  const appliedOnPage = jobs.filter((j) => j.status === "APPLIED").length;
  const searchUsedPct = isFull
    ? 0
    : Math.round((searchesUsed / Math.max(searchesLimit, 1)) * 100);
  const ratingUsedPct = isFull
    ? 0
    : Math.round((ratingsUsed / Math.max(ratingsLimit, 1)) * 100);
  const tokenUsedPct =
    dailyTokenLimit > 0
      ? Math.round((dailyTokensUsed / dailyTokenLimit) * 100)
      : 0;

  return (
    <div className="page-shell">
      <div style={{ marginBottom: 20 }}>
        <h1 className="page-title">Jobs</h1>
        <p className="page-subtitle">
          Ranked listings from your searches — filter by score, status, or
          keyword.
        </p>
      </div>

      {data && (
        <div className="dash-metrics">
          <div className="dash-metric">
            <span className="dash-metric-label">Total saved</span>
            <span className="dash-metric-value">{data.total}</span>
            <span className="dash-metric-hint">All time in your account</span>
          </div>
          <div className="dash-metric">
            <span className="dash-metric-label">Strong on page</span>
            <span className="dash-metric-value is-success">{strongOnPage}</span>
            <span className="dash-metric-hint">Score 7+ in current view</span>
          </div>
          <div className="dash-metric">
            <span className="dash-metric-label">Apply soon</span>
            <span
              className={`dash-metric-value${highScoreUnaplied.length > 0 ? " is-warning" : ""}`}
            >
              {highScoreUnaplied.length}
            </span>
            <span className="dash-metric-hint">8+ still marked New</span>
          </div>
          <div className="dash-metric">
            <span className="dash-metric-label">Applied on page</span>
            <span className="dash-metric-value">{appliedOnPage}</span>
            <span className="dash-metric-hint">In your active pipeline</span>
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
                isRatingsLimited
                  ? " is-limit"
                  : ratingsRemaining <= 2 && !isFull
                    ? " is-warn"
                    : ""
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
                  {formatTokens(dailyTokensUsed)} /{" "}
                  {formatTokens(dailyTokenLimit)}
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
              <AlertCircle size={12} /> Rating limit reached — click to request
              more access
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
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 14,
            background: "var(--warning-bg)",
            border: "1px solid var(--warning-border)",
            borderRadius: 12,
            padding: "14px 18px",
            marginBottom: 20,
          }}
        >
          <AlertCircle
            size={18}
            style={{ color: "var(--warning)", flexShrink: 0 }}
          />
          <p
            style={{
              fontSize: 14,
              color: "var(--text)",
              margin: 0,
              flex: 1,
              lineHeight: 1.5,
            }}
          >
            <strong>Hey!</strong> {highScoreUnaplied.length} jobs scoring 8+/10
            are sitting unapplied. Don&apos;t let good opportunities slip by.
          </p>
          <button
            onClick={() => {
              setScoreMin(8);
              setStatusFilter("NEW");
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
      )}

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
              ? "Search jobs (unlimited)"
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
            <>
              {isFull
                ? "Rate now (unlimited)"
                : `Rate now (${ratingsRemaining} left)`}
            </>
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

        <button
          onClick={() => setShowFilters(!showFilters)}
          className="btn btn-ghost"
        >
          <SlidersHorizontal size={13} />
          Filters
          {(scoreMin > 0 || statusFilter) && (
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
              {[scoreMin > 0, !!statusFilter].filter(Boolean).length}
            </span>
          )}
        </button>

        <button
          onClick={() => refetch()}
          className="btn btn-ghost"
          style={{ padding: "9px 11px" }}
        >
          <RefreshCw size={14} />
        </button>
      </div>

      {showFilters && (
        <div
          className="card"
          style={{
            padding: 16,
            marginBottom: 18,
            display: "flex",
            gap: 20,
            flexWrap: "wrap",
          }}
        >
          <div>
            <p className="label" style={{ marginBottom: 8 }}>
              Score
            </p>
            <div style={{ display: "flex", gap: 6 }}>
              {SCORE_OPTS.map((o) => (
                <button
                  key={o.label}
                  onClick={() => {
                    setScoreMin(o.min);
                    setPage(1);
                  }}
                  style={{
                    padding: "6px 12px",
                    fontSize: 13,
                    borderRadius: 8,
                    cursor: "pointer",
                    border: "none",
                    background:
                      scoreMin === o.min
                        ? "var(--accent)"
                        : "var(--bg-secondary)",
                    color:
                      scoreMin === o.min ? "#fff" : "var(--text-secondary)",
                    fontWeight: scoreMin === o.min ? 600 : 400,
                    transition: "all 0.15s",
                  }}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="label" style={{ marginBottom: 8 }}>
              Status
            </p>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {STATUS_OPTS.map((o) => (
                <button
                  key={o.label}
                  onClick={() => {
                    setStatusFilter(o.value);
                    setPage(1);
                  }}
                  style={{
                    padding: "6px 12px",
                    fontSize: 13,
                    borderRadius: 8,
                    cursor: "pointer",
                    border: "none",
                    background:
                      statusFilter === o.value
                        ? "var(--accent)"
                        : "var(--bg-secondary)",
                    color:
                      statusFilter === o.value
                        ? "#fff"
                        : "var(--text-secondary)",
                    fontWeight: statusFilter === o.value ? 600 : 400,
                    transition: "all 0.15s",
                  }}
                >
                  {o.label}
                </button>
              ))}
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
            No jobs found. Search to discover new roles.
          </p>
          <button
            onClick={() => crawlMutation.mutate()}
            className="btn btn-primary"
          >
            <Search size={14} /> Search for jobs
          </button>
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
              onHidden={() =>
                queryClient.invalidateQueries({ queryKey: ["jobs"] })
              }
            />
          ))}
        </div>
      )}

      {totalPages > 1 && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 12,
            marginTop: 32,
          }}
        >
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
            className="btn btn-ghost"
          >
            Previous
          </button>
          <span
            style={{
              fontSize: 14,
              color: "var(--text-muted)",
              fontFamily: "monospace",
            }}
          >
            {page} / {totalPages}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page === totalPages}
            className="btn btn-ghost"
          >
            Next
          </button>
        </div>
      )}

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
        <LimitContactModal
          kind={limitModalKind}
          onClose={() => setLimitModalKind(null)}
        />
      )}
    </div>
  );
}
