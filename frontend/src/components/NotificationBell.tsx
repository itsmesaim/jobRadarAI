import { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Bell, X } from "lucide-react";
import { userApi } from "../api/index";

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data } = useQuery({
    queryKey: ["notifications"],
    queryFn: userApi.getNotifications,
    refetchInterval: 60000,
  });

  const seenMutation = useMutation({
    mutationFn: userApi.markNotificationsSeen,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notifications"] }),
  });

  const dismissMutation = useMutation({
    mutationFn: userApi.dismissNotification,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notifications"] }),
  });

  const notifications = data?.notifications ?? [];
  const unseenCount = data?.unseen_count ?? 0;

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next && unseenCount > 0) seenMutation.mutate();
  };

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
        onClick={toggle}
        className="btn btn-ghost"
        style={{ padding: "var(--space-2) var(--space-3)", position: "relative" }}
        title="Notifications"
        aria-label="Notifications"
        aria-expanded={open}
      >
        <Bell size={16} />
        {unseenCount > 0 && <span className="notification-bell-badge">{unseenCount}</span>}
      </button>

      {open && (
        <div className="notification-dropdown">
          {notifications.length === 0 ? (
            <p className="notification-dropdown-empty">You're all caught up.</p>
          ) : (
            notifications.map((n) => (
              <div key={n.key} style={{ display: "flex", alignItems: "stretch" }}>
                <button
                  type="button"
                  className="notification-dropdown-item"
                  style={{ flex: 1 }}
                  onClick={() => {
                    setOpen(false);
                    navigate(n.link);
                  }}
                >
                  {n.message}
                </button>
                <button
                  type="button"
                  className="btn btn-ghost"
                  title="Dismiss"
                  aria-label="Dismiss"
                  style={{ padding: "0 var(--space-2)" }}
                  onClick={(e) => {
                    e.stopPropagation();
                    dismissMutation.mutate(n.key);
                  }}
                >
                  <X size={14} />
                </button>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
