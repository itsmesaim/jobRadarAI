import { useState } from "react";
import { Cpu } from "lucide-react";
import { Modal, ModalActions, ModalNote } from "./Modal";
import type { AiModelCatalogEntry } from "../types";

export function SetRatingModelModal({
  title = "Set rating model",
  userEmail,
  defaultProvider,
  defaultModel,
  pendingNote,
  models,
  busy,
  onSubmit,
  onCancel,
}: {
  title?: string;
  userEmail: string;
  defaultProvider: string;
  defaultModel: string;
  pendingNote?: string;
  models: AiModelCatalogEntry[];
  busy: boolean;
  onSubmit: (provider: string, model: string) => void;
  onCancel: () => void;
}) {
  const currentValue = defaultProvider && defaultModel ? `${defaultProvider}::${defaultModel}` : "";
  const [value, setValue] = useState(
    currentValue || (models[0] ? `${models[0].provider}::${models[0].model}` : ""),
  );
  const providers = Array.from(new Set(models.map((m) => m.provider)));
  const currentInCatalog = models.some((m) => `${m.provider}::${m.model}` === currentValue);

  return (
    <Modal
      titleId="set-rating-model-modal-title"
      icon={Cpu}
      title={title}
      subtitle={`For ${userEmail}`}
      zIndex={1100}
      onCancel={onCancel}
    >
      {pendingNote && (
        <ModalNote>
          <strong>User's note:</strong> {pendingNote}
        </ModalNote>
      )}

      <label className="label">Model</label>
      <select
        className="input"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        style={{ marginBottom: "var(--space-5)" }}
        autoFocus
      >
        {currentValue && !currentInCatalog && (
          <option value={currentValue}>
            {defaultProvider}/{defaultModel} (current, not in catalog)
          </option>
        )}
        {providers.map((provider) => (
          <optgroup key={provider} label={provider}>
            {models
              .filter((m) => m.provider === provider)
              .map((m) => (
                <option key={m.id} value={`${m.provider}::${m.model}`}>
                  {m.label}
                </option>
              ))}
          </optgroup>
        ))}
      </select>
      {models.length === 0 && (
        <p style={{ fontSize: "var(--text-sm)", color: "var(--text-muted)", marginTop: -12 }}>
          No models in the catalog yet. Add one from the AI models section first.
        </p>
      )}

      <ModalActions>
        <button
          type="button"
          onClick={() => {
            const [provider, model] = value.split("::");
            if (provider && model) onSubmit(provider, model);
          }}
          disabled={busy || !value}
          className="btn btn-primary"
          style={{ flex: "1 1 180px" }}
        >
          {busy ? "Saving..." : "Save & notify user"}
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
