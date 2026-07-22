import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

export function Modal({
  titleId,
  icon: Icon,
  title,
  subtitle,
  zIndex = 1000,
  onCancel,
  children,
}: {
  titleId: string;
  icon: LucideIcon;
  title: string;
  subtitle: ReactNode;
  zIndex?: number;
  onCancel: () => void;
  children: ReactNode;
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      onClick={onCancel}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0, 0, 0, 0.72)",
        backdropFilter: "blur(4px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex,
        padding: "var(--space-4)",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--bg-card)",
          color: "var(--text)",
          borderRadius: "var(--radius-lg)",
          padding: "var(--space-6)",
          maxWidth: 440,
          width: "100%",
          boxShadow: "var(--shadow-lg)",
          border: "1px solid var(--border)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "var(--space-3)",
            marginBottom: "var(--space-4)",
          }}
        >
          <div
            style={{
              width: 42,
              height: 42,
              background: "var(--accent-light)",
              border: "1px solid var(--border)",
              borderRadius: "50%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            <Icon size={20} color="var(--accent)" />
          </div>
          <div>
            <h3
              id={titleId}
              style={{
                margin: 0,
                fontSize: "var(--text-xl)",
                fontWeight: 600,
                color: "var(--text)",
              }}
            >
              {title}
            </h3>
            <p
              style={{
                margin: "var(--space-1) 0 0",
                fontSize: "var(--text-sm)",
                color: "var(--text-secondary)",
                lineHeight: 1.45,
              }}
            >
              {subtitle}
            </p>
          </div>
        </div>

        {children}
      </div>
    </div>
  );
}

export function ModalActions({ children }: { children: ReactNode }) {
  return <div style={{ display: "flex", gap: "var(--space-3)", flexWrap: "wrap" }}>{children}</div>;
}

export function ModalNote({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        background: "var(--bg-secondary)",
        border: "1px solid var(--border)",
        color: "var(--text-secondary)",
        padding: "var(--space-3) var(--space-4)",
        borderRadius: "var(--radius)",
        marginBottom: "var(--space-5)",
        fontSize: "var(--text-base)",
        lineHeight: 1.6,
      }}
    >
      {children}
    </div>
  );
}
