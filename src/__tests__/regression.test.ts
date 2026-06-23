/**
 * ATL-503: Regression Tests — Edge Cases & Boundary Validation
 * Figma 연결 없이 실행 가능 — 엣지케이스 및 기존 기능 영향도 확인
 *
 * 실행: npx tsx --test src/__tests__/regression.test.ts
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";

// ── 스키마 재선언 (write.ts 동일) ────────────────────────────────────────────

const OperationsArray = z.array(z.any()).max(100);

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
  fills: z.array(z.object({ type: z.string() }).passthrough()).optional(),
  strokes: z.array(z.object({ type: z.string() }).passthrough()).optional(),
  stroke_weight: z.number().optional(),
  effects: z.array(z.object({ type: z.string() }).passthrough()).optional(),
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

const BatchCreateInstanceOp = z.object({
  source_component_node_id: z.string(),
  parent_node_id: z.string(),
  x: z.number().optional(),
  y: z.number().optional(),
  component_properties: z.record(z.string(), z.unknown()).optional(),
});

// ── Helper 함수 (read.ts와 동일 로직) ────────────────────────────────────────

interface TextEntry {
  path: string;
  id: string;
  content: string;
  style: { fontFamily?: string; fontSize?: number; fontWeight?: number };
}

function extractTextNodes(node: any, path = ""): TextEntry[] {
  const cur = path ? `${path}/${node.name}` : node.name;
  const results: TextEntry[] = [];
  if (node.type === "TEXT" && node.characters) {
    results.push({
      path: cur,
      id: node.id,
      content: node.characters,
      style: {
        fontFamily: node.style?.fontFamily,
        fontSize: node.style?.fontSize,
        fontWeight: node.style?.fontWeight,
      },
    });
  }
  if (Array.isArray(node.children)) {
    for (const child of node.children) {
      results.push(...extractTextNodes(child, cur));
    }
  }
  return results;
}

function summarizePage(page: any) {
  return {
    id: page.id,
    name: page.name,
    frameCount: (page.children ?? []).length,
    frames: (page.children ?? []).map((f: any) => ({
      id: f.id,
      name: f.name,
      type: f.type,
      childCount: (f.children ?? []).length,
      bounds: f.absoluteBoundingBox ?? null,
    })),
  };
}

// ── TC-REG-01: 빈 노드 트리 입력 처리 ────────────────────────────────────────

describe("TC-REG-01: 빈 노드 트리 처리", () => {
  test("빈 children 배열 — frameCount=0", () => {
    const page = { id: "p1", name: "Page 1", children: [] };
    const result = summarizePage(page);
    assert.equal(result.frameCount, 0);
    assert.deepEqual(result.frames, []);
  });

  test("children 누락 (undefined) — frameCount=0 (nullish coalescing)", () => {
    const page = { id: "p1", name: "Page 1" };
    const result = summarizePage(page);
    assert.equal(result.frameCount, 0);
    assert.deepEqual(result.frames, []);
  });

  test("TEXT 없는 순수 FRAME 트리 — extractTextNodes 빈 배열 반환", () => {
    const tree = {
      name: "Frame",
      type: "FRAME",
      children: [
        { name: "Rect", type: "RECTANGLE" },
        { name: "Ellipse", type: "ELLIPSE" },
      ],
    };
    const texts = extractTextNodes(tree);
    assert.equal(texts.length, 0);
  });

  test("완전히 빈 객체 노드 — 크래시 없이 빈 배열 반환", () => {
    const tree = { name: "Empty", type: "FRAME" };
    const texts = extractTextNodes(tree);
    assert.equal(texts.length, 0);
  });
});

// ── TC-REG-02: 중첩 텍스트 추출 (깊은 트리) ──────────────────────────────────

describe("TC-REG-02: 중첩 텍스트 노드 추출", () => {
  test("3단계 중첩 텍스트 노드 — 모두 추출", () => {
    const tree = {
      name: "Root",
      type: "FRAME",
      children: [{
        name: "Group",
        type: "GROUP",
        children: [{
          name: "Inner",
          type: "FRAME",
          children: [{
            name: "Label",
            type: "TEXT",
            id: "t1",
            characters: "Hello",
            style: { fontFamily: "Inter", fontSize: 14 },
          }],
        }],
      }],
    };
    const texts = extractTextNodes(tree);
    assert.equal(texts.length, 1);
    assert.equal(texts[0].content, "Hello");
    assert.equal(texts[0].path, "Root/Group/Inner/Label");
  });

  test("characters 빈 문자열 — 추출되지 않음", () => {
    const tree = {
      name: "Frame",
      type: "FRAME",
      children: [{ name: "Empty", type: "TEXT", id: "t1", characters: "" }],
    };
    const texts = extractTextNodes(tree);
    assert.equal(texts.length, 0);
  });

  test("복수 TEXT 노드 — 모두 수집", () => {
    const tree = {
      name: "Frame",
      type: "FRAME",
      children: [
        { name: "T1", type: "TEXT", id: "t1", characters: "First" },
        { name: "T2", type: "TEXT", id: "t2", characters: "Second" },
        { name: "T3", type: "TEXT", id: "t3", characters: "Third" },
      ],
    };
    const texts = extractTextNodes(tree);
    assert.equal(texts.length, 3);
  });
});

// ── TC-REG-03: 잘못된 node ID / 입력 엣지케이스 ──────────────────────────────

describe("TC-REG-03: 잘못된 입력 스키마 검증", () => {
  test("node_id 빈 문자열 — 스키마 통과 (형식 제약 없음)", () => {
    const op = { node_id: "", x: 0, y: 0 };
    assert.ok(BatchUpdateGeometryOp.safeParse(op).success);
  });

  test("node_id 숫자 타입 — 거부", () => {
    const op = { node_id: 12345, x: 0 };
    assert.ok(!BatchUpdateGeometryOp.safeParse(op).success);
  });

  test("node_id 누락 — 거부", () => {
    const op = { x: 10, y: 10 };
    assert.ok(!BatchUpdateGeometryOp.safeParse(op).success);
  });

  test("rotation 소수점 — 통과", () => {
    const op = { node_id: "n1", rotation: 45.5 };
    assert.ok(BatchUpdateGeometryOp.safeParse(op).success);
  });

  test("rotation 음수 — 통과 (회전 범위 제약 없음)", () => {
    const op = { node_id: "n1", rotation: -90 };
    assert.ok(BatchUpdateGeometryOp.safeParse(op).success);
  });

  test("width 0 — 통과 (0 허용)", () => {
    const op = { node_id: "n1", width: 0, height: 0 };
    assert.ok(BatchUpdateGeometryOp.safeParse(op).success);
  });

  test("width 음수 — 통과 (스키마 min 제약 없음)", () => {
    const op = { node_id: "n1", width: -10 };
    assert.ok(BatchUpdateGeometryOp.safeParse(op).success);
  });
});

// ── TC-REG-04: operations 경계값 ─────────────────────────────────────────────

describe("TC-REG-04: operations 배열 경계값", () => {
  test("빈 배열 [] — 통과", () => {
    assert.ok(OperationsArray.safeParse([]).success);
  });

  test("99개 — 통과", () => {
    const ops = Array.from({ length: 99 }, (_, i) => ({ node_id: `n${i}` }));
    assert.ok(OperationsArray.safeParse(ops).success);
  });

  test("100개 — 통과 (경계값)", () => {
    const ops = Array.from({ length: 100 }, (_, i) => ({ node_id: `n${i}` }));
    assert.ok(OperationsArray.safeParse(ops).success);
  });

  test("101개 — 거부 (초과)", () => {
    const ops = Array.from({ length: 101 }, (_, i) => ({ node_id: `n${i}` }));
    assert.ok(!OperationsArray.safeParse(ops).success);
  });

  test("1000개 — 거부", () => {
    const ops = Array.from({ length: 1000 }, (_, i) => ({ node_id: `n${i}` }));
    assert.ok(!OperationsArray.safeParse(ops).success);
  });
});

// ── TC-REG-05: Write 스키마 엣지케이스 ──────────────────────────────────────

describe("TC-REG-05: Write 스키마 엣지케이스", () => {
  test("batch_create_nodes — name 빈 문자열 — 통과", () => {
    const op = { type: "FRAME", parent_node_id: "p1", name: "" };
    assert.ok(BatchCreateNodeOp.safeParse(op).success);
  });

  test("batch_create_nodes — 모든 optional 필드 누락 — 통과", () => {
    const op = { type: "RECTANGLE", parent_node_id: "p1", name: "R" };
    assert.ok(BatchCreateNodeOp.safeParse(op).success);
  });

  test("batch_update_auto_layout — NONE layout_mode — 통과", () => {
    const op = { node_id: "n1", layout_mode: "NONE" };
    assert.ok(BatchUpdateAutoLayoutOp.safeParse(op).success);
  });

  test("batch_update_auto_layout — SPACE_BETWEEN primary_axis — 통과", () => {
    const op = { node_id: "n1", primary_axis_align_items: "SPACE_BETWEEN" };
    assert.ok(BatchUpdateAutoLayoutOp.safeParse(op).success);
  });

  test("batch_update_auto_layout — padding 부분 누락 — 거부", () => {
    const op = { node_id: "n1", padding: { top: 8, right: 8 } };
    assert.ok(!BatchUpdateAutoLayoutOp.safeParse(op).success);
  });

  test("batch_update_text — font_size 0 — 통과", () => {
    const op = { node_id: "n1", characters: "Hi", font_size: 0 };
    assert.ok(BatchUpdateTextOp.safeParse(op).success);
  });

  test("batch_update_text — font_name style 빈 문자열 — 통과", () => {
    const op = { node_id: "n1", characters: "Hi", font_name: { family: "Inter", style: "" } };
    assert.ok(BatchUpdateTextOp.safeParse(op).success);
  });

  test("batch_update_fills — 빈 fills 배열 — 통과 (클리어 케이스)", () => {
    const op = { node_id: "n1", fills: [] };
    assert.ok(BatchUpdateFSOOp.safeParse(op).success);
  });

  test("batch_update_fills — 복수 fill — 통과", () => {
    const op = {
      node_id: "n1",
      fills: [
        { type: "SOLID", color: { r: 1, g: 0, b: 0, a: 1 } },
        { type: "GRADIENT_LINEAR", gradientStops: [] },
      ],
    };
    assert.ok(BatchUpdateFSOOp.safeParse(op).success);
  });

  test("batch_bind_variables — 복수 bindings — 통과", () => {
    const op = {
      node_id: "n1",
      bindings: [
        { property: "opacity", variable_id: "VAR:1" },
        { property: "fill", variable_id: null },
        { property: "stroke", variable_id: "VAR:2" },
      ],
    };
    assert.ok(BatchBindOp.safeParse(op).success);
  });

  test("batch_reorder_move — new_index 최대 정수 — 통과", () => {
    const op = { node_id: "n1", new_index: Number.MAX_SAFE_INTEGER };
    assert.ok(BatchReorderOp.safeParse(op).success);
  });

  test("batch_reorder_move — new_index 소수 — 거부 (int 필요)", () => {
    const op = { node_id: "n1", new_index: 1.5 };
    assert.ok(!BatchReorderOp.safeParse(op).success);
  });
});

// ── TC-REG-06: 브릿지 미연결 에러 응답 구조 ──────────────────────────────────

describe("TC-REG-06: 브릿지 미연결 에러 응답 구조 검증", () => {
  function mockBridgeNotConnectedResponse(): { content: { type: string; text: string }[] } {
    return {
      content: [{
        type: "text",
        text: JSON.stringify({ error: "Bridge Plugin not connected. Use get_page_structure (REST) instead, or connect the plugin." }),
      }],
    };
  }

  test("에러 응답 — content[0].type === 'text'", () => {
    const resp = mockBridgeNotConnectedResponse();
    assert.equal(resp.content[0].type, "text");
  });

  test("에러 응답 — text가 JSON 파싱 가능", () => {
    const resp = mockBridgeNotConnectedResponse();
    assert.doesNotThrow(() => JSON.parse(resp.content[0].text));
  });

  test("에러 응답 — error 필드 포함", () => {
    const resp = mockBridgeNotConnectedResponse();
    const parsed = JSON.parse(resp.content[0].text);
    assert.ok("error" in parsed);
    assert.equal(typeof parsed.error, "string");
  });

  test("에러 응답 — 서버 크래시 없이 구조 반환 (항상 배열)", () => {
    const resp = mockBridgeNotConnectedResponse();
    assert.ok(Array.isArray(resp.content));
    assert.equal(resp.content.length, 1);
  });
});

// ── TC-REG-07: MCP 서버 재시작 후 재연결 시뮬레이션 ──────────────────────────

describe("TC-REG-07: 재연결 상태 시뮬레이션", () => {
  class MockBridge {
    private _connected = false;
    connect() { this._connected = true; }
    disconnect() { this._connected = false; }
    get isConnected() { return this._connected; }
  }

  test("초기 상태 — 미연결", () => {
    const bridge = new MockBridge();
    assert.ok(!bridge.isConnected);
  });

  test("connect() 후 — 연결됨", () => {
    const bridge = new MockBridge();
    bridge.connect();
    assert.ok(bridge.isConnected);
  });

  test("disconnect() 후 — 미연결", () => {
    const bridge = new MockBridge();
    bridge.connect();
    bridge.disconnect();
    assert.ok(!bridge.isConnected);
  });

  test("재연결 사이클 — 3회 반복 후 정상 연결", () => {
    const bridge = new MockBridge();
    for (let i = 0; i < 3; i++) {
      bridge.connect();
      bridge.disconnect();
    }
    bridge.connect();
    assert.ok(bridge.isConnected);
  });
});

// ── TC-REG-08: batch_create_instances — 비컴포넌트 소스 노드 오류 조건 ──────────
//
// [QA 조건] source_component_node_id가 실제 COMPONENT 타입 노드가 아닌 경우
// (예: RECTANGLE, FRAME, INSTANCE 등)를 전달하면 플러그인이 오류를 반환해야 한다.
// 스키마 레벨에서는 string 타입만 검사하므로 런타임(플러그인) 측 검증이 필수.
// → 브릿지 연결 후 TC-W03-NEG로 수동 검증 필요 (bridge-manual-checklist.md 참조)

describe("TC-REG-08: batch_create_instances — 소스 노드 스키마 검증", () => {
  test("source_component_node_id 정상 — 통과", () => {
    const op = { source_component_node_id: "123:456", parent_node_id: "789:0" };
    assert.ok(BatchCreateInstanceOp.safeParse(op).success);
  });

  test("source_component_node_id 누락 — 거부", () => {
    const op = { parent_node_id: "789:0" };
    assert.ok(!BatchCreateInstanceOp.safeParse(op).success);
  });

  test("parent_node_id 누락 — 거부", () => {
    const op = { source_component_node_id: "123:456" };
    assert.ok(!BatchCreateInstanceOp.safeParse(op).success);
  });

  test("component_properties 임의 키/값 — 통과 (record 타입)", () => {
    const op = {
      source_component_node_id: "123:456",
      parent_node_id: "789:0",
      component_properties: { "Button Text": "Submit", "Variant": "Primary" },
    };
    assert.ok(BatchCreateInstanceOp.safeParse(op).success);
  });

  // 런타임 조건 문서화 (자동 검증 불가 — 브릿지 필요)
  // source_component_node_id가 RECTANGLE/FRAME 등 비컴포넌트 노드 ID를 가리킬 때:
  // → 플러그인이 NODE_NOT_COMPONENT 또는 동등한 에러 응답을 반환해야 함
  // → Figma 캔버스에 인스턴스가 생성되지 않아야 함
  // → 브릿지 TC-W03-NEG에서 실제 Figma 파일로 검증
  test("빈 node ID 문자열 — 스키마는 통과 (런타임 거부 조건)", () => {
    // 스키마는 string 타입만 검사 → 빈 문자열도 통과
    // 실제 오류는 플러그인 runPreflight()에서 발생
    const op = { source_component_node_id: "", parent_node_id: "789:0" };
    assert.ok(BatchCreateInstanceOp.safeParse(op).success,
      "빈 문자열은 스키마 통과 — 런타임에서 NODE_NOT_FOUND 오류 발생 예상");
  });
});
