import type { WizardConfig } from "../../../api/config";

interface StepProps {
  config: WizardConfig;
  onUpdate: (patch: Partial<WizardConfig>) => void;
  onNext: () => void;
  onBack?: () => void;
}

export function Welcome({ onNext }: StepProps) {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-serif text-2xl font-bold text-fg-default">Welcome to Memoark</h1>
        <p className="mt-2 text-fg-muted">
          Memoark is a local-first AI memory layer. This wizard will help you configure
          your LLM, embedding model, data sources, and storage in a few steps.
        </p>
      </div>
      <p className="text-sm text-fg-muted">This takes about 5 minutes.</p>
      <div className="flex justify-end">
        <button
          onClick={onNext}
          className="rounded bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
        >
          Get Started →
        </button>
      </div>
    </div>
  );
}
