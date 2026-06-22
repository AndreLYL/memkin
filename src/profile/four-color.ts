/**
 * Behavior-quadrant (D/I/S/C) → four-color shell (Spec 8 §5).
 *
 * Pure, deterministic mapping. The dominant axes (level === "high") select the
 * colour(s); dual colours are allowed. Every output carries the mandatory
 * "通俗映射，非临床诊断" disclaimer — we present a popular framing, NOT a clinical
 * diagnosis, and we do not use the "DiSC" trademark.
 */

import type { Axis, FourColor, TraitLayer } from "./types.js";

export const FOUR_COLOR_DISCLAIMER = "通俗映射，非临床诊断";

const AXIS_COLOR: Record<Axis, string> = {
  D: "🔴 红",
  I: "🟡 黄",
  S: "🟢 绿",
  C: "🔵 蓝",
};

const AXIS_DESC: Record<Axis, string> = {
  D: "直接、目标导向、要结论",
  I: "活跃、重关系、爱表达",
  S: "温和、求稳、重配合",
  C: "严谨、重数据、求准确",
};

// Stable display order so dual colours are deterministic regardless of input order.
const AXIS_ORDER: Axis[] = ["D", "I", "S", "C"];

export function toFourColor(trait: TraitLayer): FourColor {
  if (trait.insufficient) {
    return { colors: [], descriptions: [], disclaimer: FOUR_COLOR_DISCLAIMER };
  }

  const highAxes = new Set<Axis>(
    trait.dimensions.filter((d) => d.level === "high").map((d) => d.axis),
  );

  const colors: string[] = [];
  const descriptions: string[] = [];
  for (const axis of AXIS_ORDER) {
    if (highAxes.has(axis)) {
      colors.push(AXIS_COLOR[axis]);
      descriptions.push(AXIS_DESC[axis]);
    }
  }

  return { colors, descriptions, disclaimer: FOUR_COLOR_DISCLAIMER };
}
