import { useState } from "react";

interface SecretInputProps {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  required?: boolean;
}

export function SecretInput({ id, label, value, onChange, placeholder, required }: SecretInputProps) {
  const [show, setShow] = useState(false);
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium text-fg-default">
        {label}{required && <span className="text-red-500 ml-1">*</span>}
      </label>
      <div className="flex gap-2">
        <input
          id={id}
          type={show ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="flex-1 rounded border border-border-default bg-bg-default px-3 py-1.5 text-sm text-fg-default focus:outline-none focus:ring-2 focus:ring-accent"
        />
        <button
          type="button"
          onClick={() => setShow((s) => !s)}
          className="rounded border border-border-default px-2 py-1 text-xs text-fg-muted hover:text-fg-default"
        >
          {show ? "Hide" : "Show"}
        </button>
      </div>
    </div>
  );
}
