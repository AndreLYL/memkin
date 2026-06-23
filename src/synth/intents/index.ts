import { registerIntent } from "../intent.js";
import { recallIntent } from "./recall.js";

// Explicit registration (no implicit import-order side effects).
// Spec 8/9/11 append their own registerIntent(...) lines here.
registerIntent(recallIntent);
