import { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { FileCheck2 } from "lucide-react";
import { jobsApi } from "../api/index";
import { timeAgo } from "../utils/time";

export function CvHistoryBell() {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  const { data } = useQuery({
    queryKey: ["apply-packs"],
    queryFn: () => jobsApi.listApplyPacks(),
    refetchInterval: 60000,
  });

  const jobs = data?.jobs ?? [];

  useEffect(() => {
    if (!open) return;
    const onClickOutside = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [open]);

  return (
    <div ref={wrapperRef} style={{ position: "relative" }}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="btn btn-ghost"
        style={{ padding: "var(--space-2) var(--space-3)", position: "relative" }}
        title="CVs you've built"
        aria-label="CVs you've built"
        aria-expanded={open}
      >
        <FileCheck2 size={16} />
        {jobs.length > 0 && <span className="cv-history-badge">{jobs.length}</span>}
      </button>

      {open && (
        <div className="notification-dropdown">
          <p
            style={{
              padding: "var(--space-2) var(--space-3)",
              margin: 0,
              fontSize: "var(--text-xs)",
              fontWeight: 600,
              color: "var(--text-muted)",
              textTransform: "uppercase",
              letterSpacing: "0.03em",
            }}
          >
            CVs you've built
          </p>
          {jobs.length === 0 ? (
            <p className="notification-dropdown-empty">No CVs built yet.</p>
          ) : (
            jobs.map((job) => (
              <button
                key={job.id}
                type="button"
                className="notification-dropdown-item"
                onClick={() => {
                  setOpen(false);
                  navigate(`/?job_id=${encodeURIComponent(job.id)}`);
                }}
              >
                {job.title}
                {job.company ? ` - ${job.company}` : ""}
                <br />
                <span style={{ color: "var(--text-muted)", fontSize: "var(--text-xs)" }}>
                  {timeAgo(job.cv_generated_at)}
                </span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
