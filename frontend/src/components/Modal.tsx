import type { HTMLAttributes, ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

/**
 * Shared fixed-position backdrop every modal in this app sits on. Each modal
 * keeps its own inner card markup/styling - this only dedupes the outer
 * position:fixed/inset:0/flex-center wrapper.
 */
export function Overlay({
  zIndex = 1000,
  padding = "var(--space-4)",
  align = "center",
  dim = 0.55,
  blur = false,
  children,
  style,
  ...rest
}: {
  zIndex?: number;
  padding?: string | number;
  align?: "center" | "flex-end";
  dim?: number;
  blur?: boolean;
  children: ReactNode;
} & HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      {...rest}
      style={{
        position: "fixed",
        inset: 0,
        background: `rgba(0, 0, 0, ${dim})`,
        ...(blur ? { backdropFilter: "blur(4px)" } : {}),
        display: "flex",
        alignItems: align === "center" ? "center" : "flex-end",
        justifyContent: "center",
        zIndex,
        padding,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

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
    <Overlay
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      onClick={onCancel}
      zIndex={zIndex}
      dim={0.72}
      blur
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
    </Overlay>
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
