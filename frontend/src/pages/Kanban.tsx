import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { ExternalLink } from "lucide-react";
import {
  DndContext,
  DragOverlay,
  closestCorners,
  PointerSensor,
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

function KanbanCard({ job }: { job: Job }) {
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
    opacity: isDragging ? 0.4 : 1,
    touchAction: "none" as const,
  };

  return (
    <div
      ref={setNodeRef}
      style={{
        ...style,
        padding: 12,
        fontSize: 12,
        cursor: "grab",
        background: "var(--bg-card)",
        border: "1px solid var(--border)",
        borderRadius: 10,
        userSelect: "none",
      }}
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
            onClick={(e) => e.stopPropagation()}
            style={{ color: "var(--text-muted)", display: "flex" }}
          >
            <ExternalLink size={11} />
          </a>
        )}
      </div>
    </div>
  );
}

function KanbanColumn({
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
    <div style={{ width: 230, flexShrink: 0 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 10,
          paddingBottom: 8,
          borderBottom: `2px solid ${color}`,
        }}
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
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 8,
            minHeight: 120,
            padding: 6,
            borderRadius: 10,
            background: isOver ? "var(--accent-light)" : "transparent",
            border: isOver
              ? "2px dashed var(--accent)"
              : "2px dashed transparent",
            transition: "all 0.15s",
          }}
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
            jobs.map((job) => <KanbanCard key={job.id} job={job} />)
          )}
        </div>
      </SortableContext>
    </div>
  );
}

export function KanbanPage() {
  const queryClient = useQueryClient();
  const [activeJob, setActiveJob] = useState<Job | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["kanban"],
    queryFn: () => jobsApi.list({ limit: 100 }),
  });

  const jobs = data?.jobs ?? [];

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 },
    }),
  );

  const byStatus = (s: JobStatus) => jobs.filter((j) => j.status === s);
  const findJobById = (id: string) => jobs.find((j) => j.id === id);

  const handleDragStart = (event: DragStartEvent) => {
    const job = findJobById(event.active.id as string);
    setActiveJob(job ?? null);
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveJob(null);
    if (!over) return;

    const activeId = active.id as string;
    const overId = over.id as string;

    let targetStatus: JobStatus | undefined;
    const overIsColumn = COLUMNS.some((c) => c.status === overId);

    if (overIsColumn) {
      targetStatus = overId as JobStatus;
    } else {
      const overJob = findJobById(overId);
      targetStatus = overJob?.status;
    }

    if (!targetStatus) return;

    const activeJobData = findJobById(activeId);
    if (!activeJobData || activeJobData.status === targetStatus) return;

    queryClient.setQueryData(["kanban"], (old: any) => {
      if (!old) return old;
      return {
        ...old,
        jobs: old.jobs.map((j: Job) =>
          j.id === activeId ? { ...j, status: targetStatus } : j,
        ),
      };
    });

    try {
      await jobsApi.updateStatus(activeId, targetStatus);
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
    <div style={{ padding: "20px 0 20px 16px", overflowX: "auto" }}>
      {isLoading ? (
        <div
          style={{
            fontSize: 13,
            color: "var(--text-muted)",
            padding: "40px 16px",
          }}
        >
          Loading pipeline...
        </div>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCorners}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        >
          <div
            style={{
              display: "flex",
              gap: 12,
              minWidth: "max-content",
              paddingRight: 16,
            }}
          >
            {COLUMNS.map(({ status, label, color }) => (
              <KanbanColumn
                key={status}
                status={status}
                label={label}
                color={color}
                jobs={byStatus(status)}
              />
            ))}
          </div>

          <DragOverlay>
            {activeJob ? (
              <div
                style={{
                  padding: 12,
                  fontSize: 12,
                  background: "var(--bg-card)",
                  border: "1px solid var(--accent)",
                  borderRadius: 10,
                  boxShadow: "var(--shadow-lg)",
                  width: 220,
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
      )}
    </div>
  );
}
