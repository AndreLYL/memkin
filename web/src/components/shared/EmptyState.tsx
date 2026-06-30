import { Inbox, type LucideIcon } from "lucide-react";

interface EmptyStateProps {
  icon?: LucideIcon | string;
  title: string;
  description?: string;
  action?: { label: string; onClick: () => void };
}

export function EmptyState({ icon: Icon = Inbox, title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      {typeof Icon === "string" ? (
        <span className="text-4xl mb-3">{Icon}</span>
      ) : (
        <Icon size={32} strokeWidth={1.75} className="text-fg-subtle mb-3" />
      )}
      <h3 className="text-lg font-medium text-fg-default">{title}</h3>
      {description && <p className="text-sm text-fg-muted mt-1 max-w-md">{description}</p>}
      {action && (
        <button
          onClick={action.onClick}
          className="mt-4 px-4 py-2 bg-accent-muted text-fg-default rounded-lg text-sm hover:bg-accent transition-colors"
        >
          {action.label}
        </button>
      )}
    </div>
  );
}
