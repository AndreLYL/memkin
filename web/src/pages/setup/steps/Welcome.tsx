interface WelcomeProps {
  onExpress: () => void;
  onFull: () => void;
}

export function Welcome({ onExpress, onFull }: WelcomeProps) {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-serif text-2xl font-bold text-fg-default">Welcome to Memkin</h1>
        <p className="mt-2 text-fg-muted">
          Memkin is a local-first AI memory layer. Pick how you'd like to start.
        </p>
      </div>

      <div className="flex flex-col gap-3">
        <button
          onClick={onExpress}
          className="flex flex-col items-start gap-1 rounded-lg border border-accent bg-accent/5 p-4 text-left hover:bg-accent/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
        >
          <span className="text-sm font-semibold text-fg-default">Quick start · AI memory only</span>
          <span className="text-xs text-fg-muted">
            Just set your LLM + embedding model. Feishu and storage use sensible defaults. ~1 minute.
          </span>
        </button>

        <button
          onClick={onFull}
          className="flex flex-col items-start gap-1 rounded-lg border border-border-default p-4 text-left hover:bg-bg-subtle focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
        >
          <span className="text-sm font-semibold text-fg-default">Full setup</span>
          <span className="text-xs text-fg-muted">
            Configure everything — Feishu/Lark sources, group chats, storage paths. ~5 minutes.
          </span>
        </button>
      </div>
    </div>
  );
}
