import { ShieldAlert } from "lucide-react";
import { Modal, ModalActions, ModalNote } from "./Modal";

export function RatingProviderConfirmModal({
  label,
  busy,
  onConfirm,
  onCancel,
}: {
  label: string;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal
      titleId="rating-provider-modal-title"
      icon={ShieldAlert}
      title="Switch AI model?"
      subtitle="You're changing which AI processes this data."
      onCancel={onCancel}
    >
      <ModalNote>
        Your data will be sent to <strong>{label}</strong> from now on. This replaces your current
        selection.
      </ModalNote>

      <ModalActions>
        <button
          type="button"
          onClick={onConfirm}
          disabled={busy}
          className="btn btn-primary"
          style={{ flex: "1 1 180px" }}
        >
          {busy ? "Switching..." : `Switch to ${label}`}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="btn btn-ghost"
          style={{ flex: "0 1 auto" }}
        >
          Cancel
        </button>
      </ModalActions>
    </Modal>
  );
}
