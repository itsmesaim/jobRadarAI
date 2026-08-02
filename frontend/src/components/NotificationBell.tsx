import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Bell } from "lucide-react";
import { userApi } from "../api/index";

export function NotificationBell() {
  const [open, setOpen] = useState(false);
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

  const notifications = data?.notifications ?? [];
  const unseenCount = data?.unseen_count ?? 0;

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next && unseenCount > 0) seenMutation.mutate();
  };

  return (
    <div style={{ position: "relative" }}>
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
        <>
          <div style={{ position: "fixed", inset: 0, zIndex: 90 }} onClick={() => setOpen(false)} />
          <div className="notification-dropdown">
            {notifications.length === 0 ? (
              <p className="notification-dropdown-empty">You're all caught up.</p>
            ) : (
              notifications.map((n, i) => (
                <button
                  key={i}
                  type="button"
                  className="notification-dropdown-item"
                  onClick={() => {
                    setOpen(false);
                    navigate(n.link);
                  }}
                >
                  {n.message}
                </button>
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
}
