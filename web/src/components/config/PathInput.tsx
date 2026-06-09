interface PathInputProps {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  defaultHint?: string;
  optional?: boolean;
}

export function PathInput({ id, label, value, onChange, defaultHint, optional }: PathInputProps) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium text-fg-default">
        {label}{optional && <span className="text-fg-muted ml-1 font-normal">(optional)</span>}
      </label>
      <input
        id={id}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={defaultHint}
        className="rounded border border-border-default bg-bg-default px-3 py-1.5 text-sm text-fg-default placeholder:text-fg-muted focus:outline-none focus:ring-2 focus:ring-blue-500"
      />
      {defaultHint && !value && (
        <p className="text-xs text-fg-muted">Default: {defaultHint}</p>
      )}
    </div>
  );
}
