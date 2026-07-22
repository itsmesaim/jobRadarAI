import { useState } from "react";
import { Sparkles } from "lucide-react";
import { Modal, ModalActions } from "./Modal";

export function RequestModelModal({
  busy,
  onSubmit,
  onCancel,
}: {
  busy: boolean;
  onSubmit: (model: string, note: string) => void;
  onCancel: () => void;
}) {
  const [model, setModel] = useState("");
  const [note, setNote] = useState("");

  return (
    <Modal
      titleId="request-model-modal-title"
      icon={Sparkles}
      title="Request a different model"
      subtitle="We'll email the admin, who can enable it for your account."
      onCancel={onCancel}
    >
      <label className="label">Model name</label>
      <input
        className="input"
        placeholder="e.g. gpt-4.1, claude-sonnet-5, deepseek-reasoner"
        value={model}
        onChange={(e) => setModel(e.target.value)}
        style={{ marginBottom: "var(--space-3)" }}
        autoFocus
      />

      <label className="label">Why? (optional)</label>
      <textarea
        className="input"
        placeholder="Anything that helps us decide, e.g. cost, quality, a provider you already trust"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        rows={3}
        style={{ resize: "vertical", marginBottom: "var(--space-5)" }}
      />

      <ModalActions>
        <button
          type="button"
          onClick={() => model.trim() && onSubmit(model.trim(), note.trim())}
          disabled={busy || !model.trim()}
          className="btn btn-primary"
          style={{ flex: "1 1 180px" }}
        >
          {busy ? "Sending..." : "Send request"}
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
