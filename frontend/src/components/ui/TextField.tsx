import type { InputHTMLAttributes } from "react";

interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  hint?: string;
}

export function TextField({ label, hint, className = "", id, ...props }: TextFieldProps) {
  const inputId = id || label?.toLowerCase().replace(/\s+/g, "-");
  return (
    <div>
      {label && (
        <label className="label" htmlFor={inputId}>
          {label}
        </label>
      )}
      <input id={inputId} className={`input ${className}`.trim()} {...props} />
      {hint && (
        <p
          style={{
            fontSize: "var(--text-xs)",
            color: "var(--text-muted)",
            margin: "var(--space-2) 0 0",
            lineHeight: 1.5,
          }}
        >
          {hint}
        </p>
      )}
    </div>
  );
}
