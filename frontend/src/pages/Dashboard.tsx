import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Search,
  Plus,
  RefreshCw,
  SlidersHorizontal,
  AlertCircle,
  X,
} from "lucide-react";
import toast from "react-hot-toast";
import { JobCard } from "../components/JobCard";
import { ManualJDModal } from "../components/ManualJDModal";
import { jobsApi, crawlerApi } from "../api/index";

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

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(searchQuery), 400);
    return () => clearTimeout(t);
  }, [searchQuery]);

  const queryClient = useQueryClient();

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
          jobsApi.rateAll();
          toast("Rating jobs in background...", { icon: "⚡", duration: 3000 });
        }, 800);
      }
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.detail || "Search failed");
    },
  });

  const jobs = data?.jobs ?? [];
  const totalPages = data?.pages ?? 1;

  const highScoreUnaplied = jobs.filter(
    (j) => (j.score ?? 0) >= 8 && j.status === "NEW",
  );
  const showReminder = !reminderDismissed && highScoreUnaplied.length >= 2;

  return (
    <div style={{ maxWidth: 1180, margin: "0 auto", padding: "28px 20px" }}>
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
            are sitting unapplied. Don't let good opportunities slip by 👀
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
          onClick={() => crawlMutation.mutate()}
          disabled={crawlMutation.isPending}
          className="btn btn-primary"
        >
          <Search size={14} />
          {crawlMutation.isPending ? "Searching..." : "Search jobs"}
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
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(360px, 1fr))",
            gap: 16,
          }}
        >
          {jobs.map((job) => (
            <JobCard
              key={job.id}
              job={job}
              onStatusChange={() =>
                queryClient.invalidateQueries({ queryKey: ["jobs"] })
              }
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
    </div>
  );
}
