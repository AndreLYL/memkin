import { Text, useInput } from "ink";
import React from "react";
import type { DetectedSource } from "../../setup/detect-sources.js";
import {
  buildConnectionCheckPlan,
  connectionCheckSignature,
  DEFAULT_CONNECTION_STATUS,
  runConnectionCheckPlan,
} from "../connection-checks.js";
import type { ConfigDocument } from "../document.js";
import { saveConfigDocument } from "../document.js";
import type { FieldRecommendation } from "../recommendations.js";
import {
  type ConfigCenterAction,
  type ConfigCenterState,
  configCenterReducer,
  createInitialState,
} from "../reducer.js";
import { renderConfigCenter } from "./render.js";

export interface ConfigCenterAppProps {
  doc: ConfigDocument;
  recommendations?: FieldRecommendation[];
  sourceDetections?: DetectedSource[];
  onExit: () => void;
}

export type ConfigCenterDispatch = (action: ConfigCenterAction) => void;

interface AutosaveBeforeExitOptions {
  state: ConfigCenterState;
  save: (doc: ConfigDocument) => Promise<void>;
  onExit: () => void;
  dispatch: ConfigCenterDispatch;
}

export async function autosaveBeforeExit({
  state,
  save,
  onExit,
  dispatch,
}: AutosaveBeforeExitOptions): Promise<void> {
  if (!state.dirty) {
    onExit();
    return;
  }

  try {
    await save(state.doc);
    dispatch({ type: "saveSucceeded" });
    onExit();
  } catch (error) {
    dispatch({
      type: "setStatus",
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

export function ConfigCenterApp({
  doc,
  recommendations = [],
  sourceDetections = [],
  onExit,
}: ConfigCenterAppProps): React.ReactElement {
  const [state, dispatch] = React.useReducer(configCenterReducer, doc, (initialDoc) =>
    createInitialState(initialDoc, sourceDetections),
  );
  const [connectionStatus, setConnectionStatus] = React.useState(DEFAULT_CONNECTION_STATUS);
  const lastConnectionSignature = React.useRef("");
  const connectionRunId = React.useRef(0);

  React.useEffect(() => {
    if (!state.dirty || state.editing) return;

    const plan = buildConnectionCheckPlan(state.doc.draft);
    const signature = connectionCheckSignature(plan);
    if (signature === lastConnectionSignature.current) return;
    lastConnectionSignature.current = signature;

    if (!plan.llm && !plan.embedding) {
      setConnectionStatus({
        llm: { status: "incomplete" },
        embedding: { status: "incomplete" },
      });
      return;
    }

    const runId = connectionRunId.current + 1;
    connectionRunId.current = runId;
    setConnectionStatus({
      llm: plan.llm ? { status: "checking" } : { status: "incomplete" },
      embedding: plan.embedding ? { status: "checking" } : { status: "incomplete" },
    });

    void runConnectionCheckPlan(plan).then((result) => {
      if (connectionRunId.current !== runId) return;
      setConnectionStatus((current) => ({ ...current, ...result }));
    });
  }, [state.dirty, state.doc, state.editing]);

  useInput((input, key) => {
    if (state.editing) {
      if (key.return) {
        dispatch({ type: "commitEditing" });
        return;
      }
      if (key.upArrow) {
        dispatch({ type: "commitEditingAndMoveField", direction: "previous" });
        return;
      }
      if (key.downArrow || key.tab) {
        dispatch({ type: "commitEditingAndMoveField", direction: "next" });
        return;
      }
      if (key.escape) {
        dispatch({ type: "cancelEditing" });
        return;
      }
      if (key.backspace || key.delete) {
        dispatch({ type: "setEditValue", value: state.editValue.slice(0, -1) });
        return;
      }
      if (input && !key.ctrl && !key.meta) {
        dispatch({ type: "setEditValue", value: `${state.editValue}${input}` });
      }
      return;
    }

    if (input === "q" || key.escape || (input === "c" && key.ctrl)) {
      void autosaveBeforeExit({
        state,
        save: saveConfigDocument,
        onExit,
        dispatch,
      });
      return;
    }
    if (input === "s" && key.ctrl) {
      void saveConfigDocument(state.doc)
        .then(() => dispatch({ type: "saveSucceeded" }))
        .catch((error: unknown) =>
          dispatch({
            type: "setStatus",
            message: error instanceof Error ? error.message : String(error),
          }),
        );
      return;
    }
    if (state.focus === "sections" && key.upArrow) {
      dispatch({ type: "previousSection" });
      return;
    }
    if (state.focus === "sections" && (key.downArrow || key.tab)) {
      dispatch({ type: "nextSection" });
      return;
    }
    if (state.focus === "sections" && key.rightArrow) {
      dispatch({ type: "focusFields" });
      return;
    }
    if (state.focus === "fields" && key.leftArrow) {
      dispatch({ type: "focusSections" });
      return;
    }
    if (state.focus === "fields" && key.upArrow) {
      dispatch({ type: "previousField" });
      return;
    }
    if (state.focus === "fields" && (key.downArrow || key.tab)) {
      dispatch({ type: "nextField" });
      return;
    }
    if (state.focus === "fields" && key.return) {
      dispatch({ type: "toggleCurrentField", sourceDetections });
      dispatch({ type: "startEditing" });
    }
  });

  return React.createElement(
    Text,
    null,
    renderConfigCenter(state.doc, {
      sectionId: state.sectionId,
      fieldIndex: state.fieldIndex,
      editing: state.editing,
      editValue: state.editValue,
      dirty: state.dirty,
      statusMessage: state.statusMessage,
      recommendations,
      focus: state.focus,
      connectionStatus,
    }),
  );
}
