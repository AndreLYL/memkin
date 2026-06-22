import { useState } from "react";
import type { WizardConfig } from "../../api/config";
import { EmbeddingConfig } from "./steps/EmbeddingConfig";
import { FeishuConfig } from "./steps/FeishuConfig";
import { FeishuSources } from "./steps/FeishuSources";
import { GroupSelection } from "./steps/GroupSelection";
import { LLMConfig } from "./steps/LLMConfig";
import { Review } from "./steps/Review";
import { StoragePaths } from "./steps/StoragePaths";
import { Welcome } from "./steps/Welcome";

const TOTAL_STEPS = 8;

const STEP_LABELS = [
  "Welcome",
  "LLM",
  "Embedding",
  "Feishu",
  "Sources",
  "Groups",
  "Storage",
  "Review",
];

export function SetupWizard() {
  const [step, setStep] = useState(0);
  const [config, setConfig] = useState<WizardConfig>({
    sources: { "claude-code": { enabled: true } },
  });

  const update = (patch: Partial<WizardConfig>) =>
    setConfig((prev) => ({ ...prev, ...patch }));

  const feishuEnabled = config.sources?.feishu?.enabled ?? false;
  const messagesEnabled = config.sources?.feishu?.sources?.messages ?? false;

  const next = () => {
    setStep((s) => {
      if (s === 3 && !feishuEnabled) return 6;
      if (s === 4 && !messagesEnabled) return 6;
      return Math.min(s + 1, TOTAL_STEPS - 1);
    });
  };

  const back = () => {
    setStep((s) => {
      if (s === 6 && !feishuEnabled) return 3;
      if (s === 6 && !messagesEnabled) return 4;
      return Math.max(s - 1, 0);
    });
  };

  const stepProps = { config, onUpdate: update, onNext: next, onBack: step > 0 ? back : undefined };
  const steps = [
    <Welcome {...stepProps} />,
    <LLMConfig {...stepProps} />,
    <EmbeddingConfig {...stepProps} />,
    <FeishuConfig {...stepProps} />,
    <FeishuSources {...stepProps} />,
    <GroupSelection {...stepProps} />,
    <StoragePaths {...stepProps} />,
    <Review {...stepProps} />,
  ];

  return (
    <div className="min-h-screen bg-bg-canvas flex items-start justify-center pt-16 px-4">
      <div className="w-full max-w-xl">
        <div className="mb-6">
          <div className="flex justify-between text-xs text-fg-muted mb-1">
            <span>Step {step + 1} of {TOTAL_STEPS}</span>
            <span>{STEP_LABELS[step]}</span>
          </div>
          <div className="h-1.5 rounded-full bg-bg-subtle">
            <div
              className="h-1.5 rounded-full bg-blue-500 transition-all"
              style={{ width: `${((step + 1) / TOTAL_STEPS) * 100}%` }}
            />
          </div>
        </div>

        <div className="rounded-lg border border-border-default bg-bg-default p-8 shadow-sm">
          {steps[step]}
        </div>
      </div>
    </div>
  );
}
