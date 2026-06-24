import { useEffect, useState } from "react";
import { useIsMobile } from "../hooks/useIsMobile";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { ChevronDown, ExternalLink } from "lucide-react";
import {
  DndContext,
  DragOverlay,
  closestCorners,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  useDroppable,
  type DragStartEvent,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { jobsApi } from "../api/index";
import { ScoreBadge } from "../components/ScoreBadge";
import type { Job, JobStatus } from "../types";

const COLUMNS: { status: JobStatus; label: string; color: string }[] = [
  { status: "NEW", label: "New", color: "var(--text-muted)" },
  { status: "SAVED", label: "Saved", color: "#3b82f6" },
  { status: "HALF_APPLIED", label: "Half applied", color: "var(--purple)" },
  { status: "APPLIED", label: "Applied", color: "var(--accent)" },
  { status: "FOLLOWUP", label: "Follow up", color: "#f97316" },
  { status: "INTERVIEWING", label: "Interviewing", color: "var(--warning)" },
  { status: "OFFER", label: "Offer", color: "var(--success)" },
  { status: "REJECTED", label: "Rejected", color: "var(--danger)" },
];

const REJECTION_QUOTES = [
  "Every no gets you closer to a yes.",
  "Rejection is redirection.",
  "Keep going — something better is coming.",
  "Even the best get rejected. It's part of the process.",
];

function StatusSelect({
  value,
  onChange,
}: {
  value: JobStatus;
  onChange: (status: JobStatus) => void;
}) {
  return (
    <div style={{ position: "relative" }}>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as JobStatus)}
        className="input"
        style={{
          appearance: "none",
          width: "auto",
          fontSize: 12,
          padding: "6px 28px 6px 10px",
          minWidth: 130,
        }}
      >
        {COLUMNS.map(({ status, label }) => (
          <option key={status} value={status}>
            {label}
          </option>
        ))}
      </select>
      <ChevronDown
        size={14}
        style={{
          position: "absolute",
          right: 8,
          top: "50%",
          transform: "translateY(-50%)",
          pointerEvents: "none",
          color: "var(--text-muted)",
        }}
      />
    </div>
  );
}

function DraggableKanbanCard({ job }: { job: Job }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: job.id, data: { status: job.status } });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.45 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      className="kanban-card"
      style={style}
      {...attributes}
      {...listeners}
    >
      <p
        style={{
          margin: "0 0 8px",
          fontWeight: 500,
          color: "var(--text)",
          lineHeight: 1.4,
          display: "-webkit-box",
          WebkitLineClamp: 2,
          WebkitBoxOrient: "vertical",
          overflow: "hidden",
        }}
      >
        {job.title}
      </p>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 6,
        }}
      >
        <ScoreBadge score={job.score} size="sm" />
        {job.url && (
          <a
            href={job.url}
            target="_blank"
            rel="noopener noreferrer"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            style={{ color: "var(--text-muted)", display: "flex" }}
          >
            <ExternalLink size={12} />
          </a>
        )}
      </div>
    </div>
  );
}

function MobileKanbanCard({
  job,
  onStatusChange,
}: {
  job: Job;
  onStatusChange: (jobId: string, status: JobStatus) => void;
}) {
  return (
    <div className="kanban-mobile-card">
      <p
        style={{
          margin: "0 0 10px",
          fontWeight: 600,
          fontSize: 14,
          color: "var(--text)",
          lineHeight: 1.45,
        }}
      >
        {job.title}
      </p>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
          flexWrap: "wrap",
        }}
      >
        <ScoreBadge score={job.score} size="sm" />
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <StatusSelect
            value={job.status}
            onChange={(status) => onStatusChange(job.id, status)}
          />
          {job.url && (
            <a
              href={job.url}
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-ghost"
              style={{ padding: "7px 9px" }}
            >
              <ExternalLink size={14} />
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

function DesktopKanbanColumn({
  status,
  label,
  color,
  jobs,
}: {
  status: JobStatus;
  label: string;
  color: string;
  jobs: Job[];
}) {
  const { setNodeRef, isOver } = useDroppable({ id: status });

  return (
    <div className="kanban-column">
      <div
        className="kanban-column-header"
        style={{ borderBottom: `2px solid ${color}` }}
      >
        <span style={{ fontSize: 12, fontWeight: 600, color }}>{label}</span>
        <span
          style={{
            fontSize: 11,
            fontFamily: "monospace",
            background: "var(--bg-secondary)",
            color: "var(--text-muted)",
            padding: "1px 6px",
            borderRadius: 20,
          }}
        >
          {jobs.length}
        </span>
      </div>

      <SortableContext
        items={jobs.map((j) => j.id)}
        strategy={verticalListSortingStrategy}
      >
        <div
          ref={setNodeRef}
          className={`kanban-column-body${isOver ? " is-over" : ""}`}
        >
          {jobs.length === 0 ? (
            <div
              style={{
                fontSize: 12,
                color: "var(--text-muted)",
                textAlign: "center",
                padding: "30px 0",
              }}
            >
              Drop here
            </div>
          ) : (
            jobs.map((job) => <DraggableKanbanCard key={job.id} job={job} />)
          )}
        </div>
      </SortableContext>
    </div>
  );
}

function DesktopKanbanBoard({
  jobs,
  onStatusChange,
}: {
  jobs: Job[];
  onStatusChange: (jobId: string, status: JobStatus) => void;
}) {
  const [activeJob, setActiveJob] = useState<Job | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 150, tolerance: 8 },
    }),
  );

  const byStatus = (s: JobStatus) => jobs.filter((j) => j.status === s);
  const findJobById = (id: string) => jobs.find((j) => j.id === id);

  const handleDragStart = (event: DragStartEvent) => {
    setActiveJob(findJobById(event.active.id as string) ?? null);
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveJob(null);
    if (!over) return;

    const activeId = active.id as string;
    const overId = over.id as string;

    let targetStatus: JobStatus | undefined;
    if (COLUMNS.some((c) => c.status === overId)) {
      targetStatus = overId as JobStatus;
    } else {
      targetStatus = findJobById(overId)?.status;
    }

    if (targetStatus) await onStatusChange(activeId, targetStatus);
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <div className="kanban-board-scroll">
        <div className="kanban-board">
          {COLUMNS.map(({ status, label, color }) => (
            <DesktopKanbanColumn
              key={status}
              status={status}
              label={label}
              color={color}
              jobs={byStatus(status)}
            />
          ))}
        </div>
      </div>

      <DragOverlay dropAnimation={null}>
        {activeJob ? (
          <div
            className="kanban-card"
            style={{
              width: 228,
              boxShadow: "var(--shadow-lg)",
              borderColor: "var(--accent)",
            }}
          >
            <p
              style={{
                margin: "0 0 8px",
                fontWeight: 500,
                color: "var(--text)",
              }}
            >
              {activeJob.title}
            </p>
            <ScoreBadge score={activeJob.score} size="sm" />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

function MobileKanbanBoard({
  jobs,
  onStatusChange,
}: {
  jobs: Job[];
  onStatusChange: (jobId: string, status: JobStatus) => void;
}) {
  const [mobileColumn, setMobileColumn] = useState<JobStatus>("NEW");
  const [tabInitialized, setTabInitialized] = useState(false);

  const byStatus = (s: JobStatus) => jobs.filter((j) => j.status === s);

  useEffect(() => {
    if (tabInitialized || jobs.length === 0) return;
    const firstWithJobs = COLUMNS.find((c) =>
      jobs.some((j) => j.status === c.status),
    );
    if (firstWithJobs) setMobileColumn(firstWithJobs.status);
    setTabInitialized(true);
  }, [jobs, tabInitialized]);

  const activeMeta = COLUMNS.find((c) => c.status === mobileColumn);
  const columnJobs = byStatus(mobileColumn);

  return (
    <>
      <div className="kanban-mobile-tabs">
        {COLUMNS.map(({ status, label, color }) => {
          const count = byStatus(status).length;
          const active = mobileColumn === status;
          return (
            <button
              key={status}
              type="button"
              className={`kanban-mobile-tab${active ? " is-active" : ""}`}
              onClick={() => setMobileColumn(status)}
              style={active ? { borderColor: color, color } : undefined}
            >
              {label}
              <span
                style={{
                  fontSize: 10,
                  fontFamily: "monospace",
                  background: "var(--bg)",
                  padding: "1px 5px",
                  borderRadius: 20,
                  color: "var(--text-muted)",
                }}
              >
                {count}
              </span>
            </button>
          );
        })}
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 12,
          paddingBottom: 8,
          borderBottom: `2px solid ${activeMeta?.color ?? "var(--border)"}`,
        }}
      >
        <span
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: activeMeta?.color ?? "var(--text)",
          }}
        >
          {activeMeta?.label}
        </span>
        <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
          {columnJobs.length} job{columnJobs.length === 1 ? "" : "s"}
        </span>
      </div>

      {columnJobs.length === 0 ? (
        <div
          className="card"
          style={{
            padding: 28,
            textAlign: "center",
            color: "var(--text-muted)",
            fontSize: 14,
          }}
        >
          No jobs in this stage yet.
        </div>
      ) : (
        <div className="kanban-mobile-list">
          {columnJobs.map((job) => (
            <MobileKanbanCard
              key={job.id}
              job={job}
              onStatusChange={onStatusChange}
            />
          ))}
        </div>
      )}
    </>
  );
}

export function KanbanPage() {
  const queryClient = useQueryClient();
  const isMobile = useIsMobile();

  const { data, isLoading } = useQuery({
    queryKey: ["kanban"],
    queryFn: () => jobsApi.list({ kanban: true }),
  });

  const jobs = data?.jobs ?? [];

  const applyStatusChange = async (jobId: string, targetStatus: JobStatus) => {
    const current = jobs.find((j) => j.id === jobId);
    if (!current || current.status === targetStatus) return;

    queryClient.setQueryData(["kanban"], (old: any) => {
      if (!old) return old;
      return {
        ...old,
        jobs: old.jobs.map((j: Job) =>
          j.id === jobId ? { ...j, status: targetStatus } : j,
        ),
      };
    });

    try {
      await jobsApi.updateStatus(jobId, targetStatus);
      if (targetStatus === "REJECTED") {
        const q =
          REJECTION_QUOTES[Math.floor(Math.random() * REJECTION_QUOTES.length)];
        toast(q, { icon: "💪", duration: 4000 });
      } else if (targetStatus === "OFFER") {
        toast.success("Congrats! 🎉 Offer secured!", { duration: 4000 });
      } else {
        toast.success(`Moved to ${targetStatus.replace("_", " ")}`);
      }
    } catch {
      toast.error("Failed to update — reverting");
      queryClient.invalidateQueries({ queryKey: ["kanban"] });
    }
  };

  return (
    <div className="kanban-page">
      <div style={{ marginBottom: 16 }}>
        <h1
          style={{
            fontSize: isMobile ? 20 : 24,
            fontWeight: 700,
            margin: "0 0 4px",
            color: "var(--text)",
          }}
        >
          Pipeline
        </h1>
        <p style={{ margin: 0, fontSize: 14, color: "var(--text-muted)" }}>
          {isLoading
            ? "Loading your board..."
            : `${jobs.length} job${jobs.length === 1 ? "" : "s"} on your board`}
        </p>
      </div>

      {isLoading ? (
        <div
          style={{
            fontSize: 13,
            color: "var(--text-muted)",
            padding: "40px 0",
          }}
        >
          Loading pipeline...
        </div>
      ) : jobs.length === 0 ? (
        <div
          className="card"
          style={{
            padding: 40,
            textAlign: "center",
            color: "var(--text-muted)",
            fontSize: 14,
          }}
        >
          No jobs on your board yet. Move jobs from the Jobs page or search for
          new roles.
        </div>
      ) : isMobile ? (
        <MobileKanbanBoard jobs={jobs} onStatusChange={applyStatusChange} />
      ) : (
        <DesktopKanbanBoard jobs={jobs} onStatusChange={applyStatusChange} />
      )}
    </div>
  );
}
