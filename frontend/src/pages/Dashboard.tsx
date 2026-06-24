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
  Mail,
  Zap,
} from "lucide-react";
import toast from "react-hot-toast";
import { JobCard } from "../components/JobCard";
import { ManualJDModal } from "../components/ManualJDModal";
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
  const [showContactModal, setShowContactModal] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(searchQuery), 400);
    return () => clearTimeout(t);
  }, [searchQuery]);

  const queryClient = useQueryClient();

  const rateMutation = useMutation({
    mutationFn: jobsApi.rateAll,
    onSuccess: (res: any) => {
      const queued = res?.queued ?? 0;
      const msg =
        queued > 0
          ? `Rating ${queued} jobs in background...`
          : "Rating jobs in background...";
      toast(msg, { icon: "⚡", duration: 4000 });
      queryClient.invalidateQueries({ queryKey: ["crawl-status"] });

      // Aggressive refetch for a couple minutes so rated jobs appear live as the background task finishes
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
      if (detail.includes("limit")) {
        toast.error(detail, { duration: 6000 });
        setShowContactModal(true);
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
    onSuccess: (res) => {
      toast.success(`Found ${res.found} jobs, ${res.stored} new`);
      if (res.stored > 0) {
        setTimeout(() => {
          jobsApi
            .rateAll()
            .then((r: any) => {
              const q = r?.queued ?? 0;
              toast(
                q > 0
                  ? `Rating ${q} new jobs in background...`
                  : "Rating jobs in background...",
                { icon: "⚡", duration: 3000 },
              );
            })
            .catch(() => {});
        }, 800);
      }
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
      queryClient.invalidateQueries({ queryKey: ["kanban"] });
      queryClient.invalidateQueries({ queryKey: ["crawl-status"] });
    },
    onError: (err: any) => {
      const detail = err.response?.data?.detail || "Search failed";
      if (detail.includes("limit")) {
        toast.error(detail, { duration: 6000 });
        setShowContactModal(true);
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

  const searchesUsed = usage?.searches_used ?? 0;
  const searchesLimit = usage?.search_limit ?? 5;
  const searchesRemaining = isFull
    ? 999
    : Math.max(0, searchesLimit - searchesUsed);

  const showLimitWarning =
    usage &&
    (ratingsUsed >= ratingsLimit * 0.7 || searchesUsed >= searchesLimit * 0.7);

  const canRate = user?.isAdmin || ratingsRemaining > 0;

  const jobs = data?.jobs ?? [];
  const totalPages = data?.pages ?? 1;

  const highScoreUnaplied = jobs.filter(
    (j) => (j.score ?? 0) >= 8 && j.status === "NEW",
  );
  const showReminder = !reminderDismissed && highScoreUnaplied.length >= 2;

  return (
    <div className="page-shell">
      {/* Page header */}
      <div style={{ marginBottom: 24 }}>
        <h1
          style={{
            fontSize: 24,
            fontWeight: 700,
            margin: "0 0 4px",
            color: "var(--text)",
          }}
        >
          Jobs
        </h1>
        {data && (
          <p style={{ margin: 0, fontSize: 14, color: "var(--text-muted)" }}>
            <strong style={{ color: "var(--text)" }}>{data.total}</strong> total
            {" · "}
            <strong style={{ color: "var(--success)" }}>
              {jobs.filter((j) => (j.score ?? 0) >= 7).length}
            </strong>{" "}
            strong matches
            {" · "}
            {jobs.filter((j) => j.status === "APPLIED").length} applied
          </p>
        )}
      </div>

      {/* Cleaner usage display (UX improved) */}
      {usage && !user?.isAdmin && (
        <div style={{ marginBottom: 14 }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {/* Searches */}
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: "5px 11px",
                background: "var(--bg-card)",
                border: "1px solid var(--border)",
                borderRadius: 999,
                fontSize: 12,
                fontWeight: 500,
              }}
            >
              <Search size={13} style={{ color: "var(--text-muted)" }} />
              {isFull ? (
                <span style={{ color: "var(--success)" }}>
                  Unlimited searches
                </span>
              ) : (
                <>
                  <span
                    style={{
                      color:
                        searchesRemaining <= 1
                          ? "var(--danger)"
                          : "var(--text)",
                    }}
                  >
                    {searchesRemaining} search
                    {searchesRemaining === 1 ? "" : "es"} left
                  </span>
                  <span
                    style={{
                      color: "var(--text-muted)",
                      fontSize: 11,
                      fontWeight: 400,
                    }}
                  >
                    / {searchesLimit}
                  </span>
                </>
              )}
            </div>

            {/* Ratings — the more important quota */}
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: "5px 11px",
                background: isRatingsLimited ? "#fef2f2" : "var(--bg-card)",
                border: isRatingsLimited
                  ? "1px solid #fecaca"
                  : "1px solid var(--border)",
                borderRadius: 999,
                fontSize: 12,
                fontWeight: 500,
              }}
            >
              <Zap
                size={13}
                style={{
                  color: isRatingsLimited ? "#ef4444" : "var(--text-muted)",
                }}
              />
              {isFull ? (
                <span style={{ color: "var(--success)" }}>
                  Unlimited ratings
                </span>
              ) : (
                <>
                  <span
                    style={{
                      color: isRatingsLimited
                        ? "#b91c1c"
                        : ratingsRemaining <= 2
                          ? "#f59e0b"
                          : "var(--text)",
                    }}
                  >
                    {ratingsRemaining} rating{ratingsRemaining === 1 ? "" : "s"}{" "}
                    left
                  </span>
                  <span
                    style={{
                      color: "var(--text-muted)",
                      fontSize: 11,
                      fontWeight: 400,
                    }}
                  >
                    / {ratingsLimit}
                  </span>
                </>
              )}
              {isRatingsLimited && (
                <button
                  onClick={() => setShowContactModal(true)}
                  style={{
                    marginLeft: 4,
                    fontSize: 10,
                    padding: "1px 6px",
                    borderRadius: 4,
                    background: "#fee2e2",
                    color: "#b91c1c",
                    border: "none",
                    cursor: "pointer",
                    fontWeight: 600,
                  }}
                >
                  upgrade
                </button>
              )}
            </div>
          </div>

          {isRatingsLimited && !isFull && (
            <div
              onClick={() => setShowContactModal(true)}
              style={{
                marginTop: 6,
                fontSize: 11,
                color: "#b91c1c",
                display: "flex",
                alignItems: "center",
                gap: 5,
                cursor: "pointer",
              }}
            >
              <AlertCircle size={12} /> Limit reached — click to request more
              access
            </div>
          )}
        </div>
      )}

      {/* Reminder banner */}
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
            are sitting unapplied. Don't let good opportunities slip by
          </p>
          <button
            onClick={() => {
              setScoreMin(8);
              setStatusFilter("NEW");
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

      {/* Action bar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          marginBottom: 18,
          flexWrap: "wrap",
        }}
      >
        <button onClick={() => setShowManual(true)} className="btn btn-ghost">
          <Plus size={14} /> Paste JD
        </button>

        <button
          onClick={() => {
            if (searchesRemaining <= 0 && !user?.isAdmin) {
              setShowContactModal(true);
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
              setShowContactModal(true);
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
          ) : (
            <>Rate limit reached</>
          )}
        </button>

        {/* search within saved jobs */}
        <input
          type="text"
          placeholder="Search saved jobs..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
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

      {/* Job grid */}
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

      {/* Pagination */}
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
          onClose={() => setShowManual(false)}
          onAdded={() => queryClient.invalidateQueries({ queryKey: ["jobs"] })}
        />
      )}

      {/* Contact Modal - Better UX for limit reached */}
      {showContactModal && (
        <div
          onClick={() => setShowContactModal(false)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "var(--bg-card)",
              borderRadius: 16,
              padding: 28,
              maxWidth: 420,
              width: "90%",
              boxShadow: "var(--shadow-lg)",
              border: "1px solid var(--border)",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                marginBottom: 16,
              }}
            >
              <div
                style={{
                  width: 42,
                  height: 42,
                  background: "#fee2e2",
                  borderRadius: "50%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <AlertCircle size={22} color="#ef4444" />
              </div>
              <div>
                <h3 style={{ margin: 0, fontSize: 19, fontWeight: 600 }}>
                  Free limit reached
                </h3>
                <p
                  style={{
                    margin: 0,
                    fontSize: 13,
                    color: "var(--text-muted)",
                  }}
                >
                  You've used all your free ratings.
                </p>
              </div>
            </div>

            <div
              style={{
                background: "#fef2f2",
                padding: 14,
                borderRadius: 10,
                marginBottom: 20,
                fontSize: 14,
              }}
            >
              <strong>You can rate up to 10 jobs for free.</strong>
              <br />
              To continue rating more jobs and unlock full access, please
              contact me directly.
            </div>

            <div style={{ display: "flex", gap: 10 }}>
              <a
                href="mailto:saimkaskar1@gmail.com?subject=JobRadar%20-%20Request%20more%20rating%20access&body=Hi%20Saim,%0A%0AI%27ve%20reached%20my%20free%20rating%20limit%20and%20would%20like%20more%20access.%0A%0AThank%20you!"
                className="btn btn-primary"
                style={{
                  flex: 1,
                  textDecoration: "none",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 8,
                }}
              >
                <Mail size={16} /> Email Saim now
              </a>
              <button
                onClick={() => setShowContactModal(false)}
                className="btn btn-ghost"
              >
                Maybe later
              </button>
            </div>

            <div
              style={{
                fontSize: 12,
                color: "var(--text-muted)",
                textAlign: "center",
                marginTop: 16,
              }}
            >
              Email: <strong>saimkaskar1@gmail.com</strong>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
