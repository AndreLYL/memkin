import { describe, expect, it } from "vitest";
import { FOUR_COLOR_DISCLAIMER, toFourColor } from "../../src/profile/four-color.js";
import type { TraitDimension, TraitLayer } from "../../src/profile/types.js";

function dim(axis: TraitDimension["axis"], level: TraitDimension["level"]): TraitDimension {
  return { axis, level, confidence: "medium", evidence_count: 3, evidence_refs: [], note: "" };
}

function trait(dims: TraitDimension[], insufficient = false): TraitLayer {
  return { dimensions: dims, insufficient };
}

describe("profile/four-color mapping", () => {
  it("maps each high axis to its color", () => {
    expect(toFourColor(trait([dim("D", "high")])).colors).toEqual(["🔴 红"]);
    expect(toFourColor(trait([dim("I", "high")])).colors).toEqual(["🟡 黄"]);
    expect(toFourColor(trait([dim("S", "high")])).colors).toEqual(["🟢 绿"]);
    expect(toFourColor(trait([dim("C", "high")])).colors).toEqual(["🔵 蓝"]);
  });

  it("supports dual colors when two axes are high", () => {
    const fc = toFourColor(trait([dim("D", "high"), dim("C", "high"), dim("I", "low")]));
    expect(fc.colors).toEqual(["🔴 红", "🔵 蓝"]);
  });

  it("always includes the 通俗映射，非临床诊断 disclaimer", () => {
    const fc = toFourColor(trait([dim("I", "high")]));
    expect(fc.disclaimer).toContain("通俗映射，非临床诊断");
    expect(FOUR_COLOR_DISCLAIMER).toContain("通俗映射，非临床诊断");
  });

  it("returns no colors when insufficient or no high axes", () => {
    expect(toFourColor(trait([], true)).colors).toEqual([]);
    expect(toFourColor(trait([dim("D", "low"), dim("I", "medium")])).colors).toEqual([]);
  });
});
