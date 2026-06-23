/**
 * ATL-502: Schema Validation Tests
 * Figma 연결 없이 실행 가능 — Zod 스키마 및 입력 유효성 검증
 *
 * 실행: npx tsx --test src/__tests__/schema-validation.test.ts
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";

// ── Schemas (write.ts에서 추출) ───────────────────────────────────────────────

const PaintSchema = z.object({ type: z.string() }).passthrough();
const EffectSchema = z.object({ type: z.string() }).passthrough();

const BatchCreateNodeOp = z.object({
  type: z.enum(["FRAME", "TEXT", "RECTANGLE", "ELLIPSE", "LINE", "COMPONENT"]),
  parent_node_id: z.string(),
  name: z.string(),
  x: z.number().optional(),
  y: z.number().optional(),
  width: z.number().optional(),
  height: z.number().optional(),
  characters: z.string().optional(),
});

const BatchUpdateGeometryOp = z.object({
  node_id: z.string(),
  x: z.number().optional(),
  y: z.number().optional(),
  width: z.number().optional(),
  height: z.number().optional(),
  rotation: z.number().optional(),
});

const BatchUpdateAutoLayoutOp = z.object({
  node_id: z.string(),
  layout_mode: z.enum(["NONE", "HORIZONTAL", "VERTICAL"]).optional(),
  primary_axis_align_items: z.enum(["MIN", "CENTER", "MAX", "SPACE_BETWEEN"]).optional(),
  counter_axis_align_items: z.enum(["MIN", "CENTER", "MAX", "BASELINE"]).optional(),
  item_spacing: z.number().optional(),
  padding: z.object({ top: z.number(), right: z.number(), bottom: z.number(), left: z.number() }).optional(),
});

const BatchUpdateTextOp = z.object({
  node_id: z.string(),
  characters: z.string(),
  font_size: z.number().optional(),
  font_name: z.object({ family: z.string(), style: z.string() }).optional(),
});

const BatchUpdateFSOOp = z.object({
  node_id: z.string(),
  fills: z.array(PaintSchema).optional(),
  strokes: z.array(PaintSchema).optional(),
  stroke_weight: z.number().optional(),
  effects: z.array(EffectSchema).optional(),
});

const BatchBindOp = z.object({
  node_id: z.string(),
  bindings: z.array(z.object({
    property: z.string(),
    variable_id: z.string().nullable(),
  })),
});

const BatchReorderOp = z.object({
  node_id: z.string(),
  new_parent_node_id: z.string().optional(),
  new_index: z.number().int().min(0).optional(),
  x: z.number().optional(),
  y: z.number().optional(),
});

const OperationsArray = z.array(z.any()).max(100);

// ── TC-E04: operations 100개 제한 ─────────────────────────────────────────────

describe("TC-E04: operations max(100) 제한", () => {
  test("TC-E04-A: 100개 operations — 통과", () => {
    const ops = Array.from({ length: 100 }, (_, i) => ({ node_id: `node-${i}` }));
    const result = OperationsArray.safeParse(ops);
    assert.ok(result.success, "100개는 통과해야 함");
  });

  test("TC-E04-B: 101개 operations — 거부", () => {
    const ops = Array.from({ length: 101 }, (_, i) => ({ node_id: `node-${i}` }));
    const result = OperationsArray.safeParse(ops);
    assert.ok(!result.success, "101개는 max(100) 초과로 거부되어야 함");
  });
});

// ── batch_create_nodes 스키마 ─────────────────────────────────────────────────

describe("batch_create_nodes 스키마 검증", () => {
  test("유효한 FRAME 생성 ops — 통과", () => {
    const op = { type: "FRAME", parent_node_id: "p1", name: "My Frame", x: 0, y: 0, width: 100, height: 100 };
    assert.ok(BatchCreateNodeOp.safeParse(op).success);
  });

  test("유효한 TEXT 생성 ops (characters 포함) — 통과", () => {
    const op = { type: "TEXT", parent_node_id: "p1", name: "Label", characters: "Hello" };
    assert.ok(BatchCreateNodeOp.safeParse(op).success);
  });

  test("허용되지 않는 type (IMAGE) — 거부", () => {
    const op = { type: "IMAGE", parent_node_id: "p1", name: "Img" };
    assert.ok(!BatchCreateNodeOp.safeParse(op).success);
  });

  test("parent_node_id 누락 — 거부", () => {
    const op = { type: "FRAME", name: "No Parent" };
    assert.ok(!BatchCreateNodeOp.safeParse(op).success);
  });
});

// ── batch_update_auto_layout 스키마 ──────────────────────────────────────────

describe("batch_update_auto_layout 스키마 검증", () => {
  test("HORIZONTAL layout_mode — 통과", () => {
    const op = { node_id: "n1", layout_mode: "HORIZONTAL", item_spacing: 8 };
    assert.ok(BatchUpdateAutoLayoutOp.safeParse(op).success);
  });

  test("허용되지 않는 layout_mode (GRID) — 거부", () => {
    const op = { node_id: "n1", layout_mode: "GRID" };
    assert.ok(!BatchUpdateAutoLayoutOp.safeParse(op).success);
  });

  test("padding 객체 구조 — 통과", () => {
    const op = { node_id: "n1", padding: { top: 8, right: 8, bottom: 8, left: 8 } };
    assert.ok(BatchUpdateAutoLayoutOp.safeParse(op).success);
  });
});

// ── batch_update_text 스키마 ─────────────────────────────────────────────────

describe("batch_update_text 스키마 검증", () => {
  test("characters 필수 — 누락 시 거부", () => {
    const op = { node_id: "n1", font_size: 16 };
    assert.ok(!BatchUpdateTextOp.safeParse(op).success);
  });

  test("font_name 구조 (family + style) — 통과", () => {
    const op = { node_id: "n1", characters: "Hi", font_name: { family: "Inter", style: "Bold" } };
    assert.ok(BatchUpdateTextOp.safeParse(op).success);
  });
});

// ── batch_update_fills_strokes_effects 스키마 ─────────────────────────────────

describe("batch_update_fills_strokes_effects 스키마 검증", () => {
  test("SOLID fill Paint 객체 — 통과", () => {
    const op = { node_id: "n1", fills: [{ type: "SOLID", color: { r: 1, g: 0, b: 0, a: 1 } }] };
    assert.ok(BatchUpdateFSOOp.safeParse(op).success);
  });

  test("type 없는 Paint 객체 — 거부", () => {
    const op = { node_id: "n1", fills: [{ color: { r: 1, g: 0, b: 0, a: 1 } }] };
    assert.ok(!BatchUpdateFSOOp.safeParse(op).success);
  });
});

// ── batch_bind_variables 스키마 ──────────────────────────────────────────────

describe("batch_bind_variables 스키마 검증", () => {
  test("variable_id null (언바인딩) — 통과", () => {
    const op = { node_id: "n1", bindings: [{ property: "opacity", variable_id: null }] };
    assert.ok(BatchBindOp.safeParse(op).success);
  });

  test("variable_id 문자열 (바인딩) — 통과", () => {
    const op = { node_id: "n1", bindings: [{ property: "opacity", variable_id: "VAR:123" }] };
    assert.ok(BatchBindOp.safeParse(op).success);
  });

  test("bindings 누락 — 거부", () => {
    const op = { node_id: "n1" };
    assert.ok(!BatchBindOp.safeParse(op).success);
  });
});

// ── batch_reorder_move 스키마 ────────────────────────────────────────────────

describe("batch_reorder_move 스키마 검증", () => {
  test("new_index 음수 — 거부", () => {
    const op = { node_id: "n1", new_index: -1 };
    assert.ok(!BatchReorderOp.safeParse(op).success);
  });

  test("new_index 0 — 통과", () => {
    const op = { node_id: "n1", new_index: 0 };
    assert.ok(BatchReorderOp.safeParse(op).success);
  });
});
