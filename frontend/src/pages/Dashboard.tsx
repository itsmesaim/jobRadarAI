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
import type { JobStatus } from "../types";

const SCORE_OPTS = [
  { label: "All scores", min: 0 },
  { label: "6+ only", min: 6 },
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
  const [scoreMin, setScoreMin] = useState(0);
  const [statusFilter, setStatusFilter] = useState<string | undefined>(
    undefined,
  );
  const [page, setPage] = useState(1);
  const [showManual, setShowManual] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [reminderDismissed, setReminderDismissed] = useState(false);

  const queryClient = useQueryClient();

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["jobs", scoreMin, statusFilter, page],
    queryFn: () =>
      jobsApi.list({
        score_min: scoreMin,
        status: statusFilter,
        page,
        limit: 20,
      }),
    refetchInterval: 30000,
  });

  const crawlMutation = useMutation({
    mutationFn: crawlerApi.search,
    onSuccess: (res) => {
      toast.success(`Found ${res.found} jobs, stored ${res.stored} new`);
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
    <div style={{ maxWidth: 1100, margin: "0 auto", padding: "20px 16px" }}>
      {/* Reminder banner */}
      {showReminder && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            background: "var(--warning-bg)",
            border: "1px solid var(--warning)",
            borderRadius: 9,
            padding: "12px 16px",
            marginBottom: 16,
          }}
        >
          <AlertCircle
            size={16}
            style={{ color: "var(--warning)", flexShrink: 0 }}
          />
          <p style={{ fontSize: 13, color: "var(--text)", margin: 0, flex: 1 }}>
            <strong>Hey!</strong> You have {highScoreUnaplied.length} jobs
            scoring 8+/10 that you haven't applied to yet. Don't let good
            opportunities slip by 👀
          </p>
          <button
            onClick={() => {
              setScoreMin(8);
              setStatusFilter("NEW");
            }}
            className="btn btn-secondary"
            style={{ fontSize: 12, padding: "4px 10px", flexShrink: 0 }}
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
            <X size={14} />
          </button>
        </div>
      )}

      {/* Top bar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginBottom: 16,
          flexWrap: "wrap",
        }}
      >
        <div style={{ flex: 1, minWidth: 200 }}>
          {data && (
            <p style={{ margin: 0, fontSize: 13, color: "var(--text-muted)" }}>
              <strong style={{ color: "var(--text)" }}>{data.total}</strong>{" "}
              jobs
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

        <button
          onClick={() => setShowManual(true)}
          className="btn btn-ghost"
          style={{ fontSize: 12 }}
        >
          <Plus size={13} /> Paste JD
        </button>

        <button
          onClick={() => crawlMutation.mutate()}
          disabled={crawlMutation.isPending}
          className="btn btn-primary"
          style={{ fontSize: 12 }}
        >
          <Search size={13} />
          {crawlMutation.isPending ? "Searching..." : "Search jobs"}
        </button>
      </div>

      {/* Filters */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginBottom: 16,
          flexWrap: "wrap",
        }}
      >
        <button
          onClick={() => setShowFilters(!showFilters)}
          className="btn btn-ghost"
          style={{ fontSize: 12, padding: "5px 10px" }}
        >
          <SlidersHorizontal size={12} />
          Filters
          {(scoreMin > 0 || statusFilter) && (
            <span
              style={{
                background: "var(--accent)",
                color: "#fff",
                borderRadius: "50%",
                width: 16,
                height: 16,
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

        {showFilters && (
          <>
            <div style={{ display: "flex", gap: 4 }}>
              {SCORE_OPTS.map((o) => (
                <button
                  key={o.label}
                  onClick={() => {
                    setScoreMin(o.min);
                    setPage(1);
                  }}
                  style={{
                    padding: "4px 10px",
                    fontSize: 12,
                    borderRadius: 6,
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

            <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
              {STATUS_OPTS.map((o) => (
                <button
                  key={o.label}
                  onClick={() => {
                    setStatusFilter(o.value);
                    setPage(1);
                  }}
                  style={{
                    padding: "4px 10px",
                    fontSize: 12,
                    borderRadius: 6,
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
          </>
        )}

        <button
          onClick={() => refetch()}
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            color: "var(--text-muted)",
            display: "flex",
            marginLeft: "auto",
          }}
        >
          <RefreshCw size={13} />
        </button>
      </div>

      {/* Job grid */}
      {isLoading ? (
        <div
          style={{
            textAlign: "center",
            padding: "60px 0",
            color: "var(--text-muted)",
            fontSize: 13,
          }}
        >
          Loading jobs...
        </div>
      ) : jobs.length === 0 ? (
        <div style={{ textAlign: "center", padding: "60px 0" }}>
          <p
            style={{
              color: "var(--text-muted)",
              fontSize: 14,
              marginBottom: 16,
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
            gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))",
            gap: 12,
          }}
        >
          {jobs.map((job) => (
            <JobCard
              key={job.id}
              job={job}
              onStatusChange={() =>
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
            gap: 10,
            marginTop: 24,
          }}
        >
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
            className="btn btn-ghost"
            style={{ fontSize: 12 }}
          >
            Previous
          </button>
          <span
            style={{
              fontSize: 13,
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
            style={{ fontSize: 12 }}
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
