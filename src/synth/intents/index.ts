import { registerIntent } from "../intent.js";
import { dailyReportIntent } from "./daily-report.js";
import { personStrategyIntent } from "./person-strategy.js";
import { recallIntent } from "./recall.js";
import { troubleshootIntent } from "./troubleshoot.js";

// Explicit registration (no implicit import-order side effects).
// Spec 8/9/11 append their own registerIntent(...) lines here.
registerIntent(recallIntent);
registerIntent(personStrategyIntent);
registerIntent(dailyReportIntent);
registerIntent(troubleshootIntent);
