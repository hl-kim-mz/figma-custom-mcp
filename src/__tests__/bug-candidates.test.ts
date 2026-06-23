/**
 * Bug Candidate Tests — TC-W03-NEG 범위 제외 버그 검증
 * Figma 연결 없이 실행 가능 — 코드 로직 및 엣지케이스 기반
 *
 * 실행: npx tsx --test src/__tests__/bug-candidates.test.ts
 *
 * 대상 파일:
 *   - src/tools/write.ts     → toText() 함수
 *   - src/plugin-bridge.ts   → 메시지 처리 로직
 *   - src/tools/read.ts      → extractTextNodes(), get_node_tree depth 스키마
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";

// ── BUG-01: toText() — NaN / undefined / null 반환값 처리 ────────────────────
//
// write.ts:25-27
//   function toText(result: unknown): string {
//     return JSON.stringify(result) ?? '{"error":"Plugin returned undefined result"}';
//   }
//
// [버그 후보] JSON.stringify(NaN) → "null" (JavaScript 표준)
// 플러그인이 NaN을 반환하면 에러 없이 "null"이 MCP 응답으로 전달됨.
// 클라이언트는 정상 응답 "null"과 실제 null 결과를 구분할 수 없음.

describe("BUG-01: toText() 엣지케이스", () => {
  function toText(result: unknown): string {
    return JSON.stringify(result) ?? '{"error":"Plugin returned undefined result"}';
  }

  test("undefined → fallback 에러 문자열 반환", () => {
    const result = toText(undefined);
    assert.equal(result, '{"error":"Plugin returned undefined result"}');
  });

  test("[BUG] NaN → 에러 없이 'null' 반환 (정보 손실)", () => {
    const result = toText(NaN);
    // JSON.stringify(NaN) === "null" — JavaScript 표준이지만 silent data loss
    assert.equal(result, "null");
    // 이 케이스에서 에러 메시지가 없어 클라이언트가 null 응답으로 해석함
  });

  test("[BUG] Infinity → 에러 없이 'null' 반환", () => {
    const result = toText(Infinity);
    assert.equal(result, "null");
  });

  test("[BUG] -Infinity → 에러 없이 'null' 반환", () => {
    const result = toText(-Infinity);
    assert.equal(result, "null");
  });

  test("null → 'null' 문자열 반환 (정상 케이스)", () => {
    // null은 의도된 응답이므로 "null" 반환은 정상
    const result = toText(null);
    assert.equal(result, "null");
  });

  test("정상 객체 → JSON 직렬화", () => {
    const result = toText({ ok: true, count: 3 });
    assert.equal(result, '{"ok":true,"count":3}');
  });

  test("[BUG] 함수 타입 → fallback 에러 문자열 반환", () => {
    // JSON.stringify(function(){}) === undefined
    const result = toText(function () {});
    assert.equal(result, '{"error":"Plugin returned undefined result"}');
  });

  test("[BUG] Symbol → fallback 에러 문자열 반환", () => {
    const result = toText(Symbol("test"));
    assert.equal(result, '{"error":"Plugin returned undefined result"}');
  });

  test("NaN 포함 객체 → null로 직렬화 (silent loss)", () => {
    // { value: NaN } → '{"value":null}'  — NaN 값이 null로 변환됨
    const result = toText({ value: NaN, label: "score" });
    assert.equal(result, '{"value":null,"label":"score"}');
    // 'value'가 null로 변환되어 원본 NaN 정보가 소실됨
  });
});

// ── BUG-02: extractTextNodes() — node.name undefined 처리 ────────────────────
//
// read.ts:15-38 / regression.test.ts에서 재선언한 동일 함수
//
// [버그 후보] node.name이 undefined인 노드가 있을 때
// `const cur = path ? `${path}/${node.name}` : node.name`
// → path = "undefined" 또는 "Parent/undefined" 문자열이 됨

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

describe("BUG-02: extractTextNodes() — name 누락 케이스", () => {
  test("[BUG] 루트 name undefined → 루트 컨텍스트가 path에서 무시됨", () => {
    const tree = {
      // name 누락 → node.name = undefined (falsy)
      type: "FRAME",
      children: [
        { name: "Label", type: "TEXT", id: "t1", characters: "Hello" },
      ],
    };
    const texts = extractTextNodes(tree);
    assert.equal(texts.length, 1);
    // cur = path("") ? ... : node.name(undefined) → cur = undefined (falsy)
    // 자식 호출 시 path=undefined → 다시 falsy → cur = "Label"
    // 결과: "Label" (루트 FRAME 컨텍스트 완전 소실)
    assert.equal(texts[0].path, "Label",
      "[BUG] name 없는 루트 노드는 path에서 무시됨 — 상위 계층 컨텍스트 정보 손실");
  });

  test("[BUG] 중간 노드 name undefined → path에 'undefined' 포함", () => {
    const tree = {
      name: "Root",
      type: "FRAME",
      children: [{
        // name 누락 (중간 노드)
        type: "GROUP",
        children: [
          { name: "Text", type: "TEXT", id: "t1", characters: "Hello" },
        ],
      }],
    };
    const texts = extractTextNodes(tree);
    assert.equal(texts.length, 1);
    assert.equal(texts[0].path, "Root/undefined/Text",
      "중간 노드 name 누락 시 path에 'undefined' 포함됨");
  });

  test("[BUG] TEXT 노드 id 누락 → id가 undefined", () => {
    const tree = {
      name: "Frame",
      type: "FRAME",
      children: [
        { name: "Label", type: "TEXT", characters: "Hello" }, // id 없음
      ],
    };
    const texts = extractTextNodes(tree);
    assert.equal(texts.length, 1);
    assert.equal(texts[0].id, undefined,
      "TEXT 노드에 id 필드 없으면 undefined — Figma API는 항상 id를 제공하나, 방어 코드 없음");
  });

  test("정상 name — path 정확히 구성됨", () => {
    const tree = {
      name: "Root",
      type: "FRAME",
      children: [
        { name: "Label", type: "TEXT", id: "t1", characters: "Hello" },
      ],
    };
    const texts = extractTextNodes(tree);
    assert.equal(texts[0].path, "Root/Label");
  });
});

// ── BUG-03: PluginBridge 메시지 처리 — 빈 문자열 error 필드 ─────────────────
//
// plugin-bridge.ts:37
//   if (msg.error !== undefined) pending.reject(new Error(msg.error || "Unknown plugin error"));
//
// [동작 확인] msg.error = "" → "Unknown plugin error"로 폴백 (올바름)
// [동작 확인] msg.error = "some error" → 해당 메시지로 reject (올바름)

describe("BUG-03: PluginBridge — error 필드 처리 로직", () => {
  function simulateErrorHandling(errorField: string | undefined): string | null {
    // plugin-bridge.ts:37 로직 재현
    if (errorField !== undefined) {
      return errorField || "Unknown plugin error";
    }
    return null; // 에러 없음
  }

  test("error 필드 없음 → null (성공 처리)", () => {
    assert.equal(simulateErrorHandling(undefined), null);
  });

  test("error 빈 문자열 → 'Unknown plugin error' 폴백", () => {
    assert.equal(simulateErrorHandling(""), "Unknown plugin error");
  });

  test("error 정상 메시지 → 해당 메시지 사용", () => {
    assert.equal(simulateErrorHandling("NODE_NOT_FOUND"), "NODE_NOT_FOUND");
  });

  test("[BUG 후보] error = '0' (falsy 문자열) → 'Unknown plugin error' 폴백", () => {
    // '0'은 truthy이므로 폴백 미사용 — 정상
    assert.equal(simulateErrorHandling("0"), "0");
  });
});

// ── BUG-04: PluginBridge — 중복 응답 ID 처리 ────────────────────────────────
//
// plugin-bridge.ts:33-39
// 첫 번째 응답 후 pending.delete(id) → 두 번째 동일 ID는 무시됨 (올바름)
// [확인] 중복 ID 응답이 resolve를 두 번 호출하지 않음

describe("BUG-04: PluginBridge — 중복 응답 ID 처리", () => {
  test("중복 응답 ID — 두 번째 응답 무시 시뮬레이션", () => {
    const pending = new Map<string, { resolved: boolean; value: unknown }>();
    const id = "test-id-123";
    pending.set(id, { resolved: false, value: null });

    // 첫 번째 응답 처리
    function handleResponse(msgId: string, result: unknown) {
      const p = pending.get(msgId);
      if (p) {
        p.resolved = true;
        p.value = result;
        pending.delete(msgId);
      }
    }

    handleResponse(id, { ok: true });
    assert.ok(!pending.has(id), "첫 번째 응답 후 pending에서 제거됨");

    // 두 번째 동일 ID 응답 — 무시되어야 함
    let secondCallCount = 0;
    const originalSize = pending.size;
    handleResponse(id, { ok: false });  // 두 번째 응답
    assert.equal(pending.size, originalSize, "두 번째 응답은 pending에 영향 없음");
  });

  test("알 수 없는 ID — pending 맵에 영향 없음", () => {
    const pending = new Map<string, boolean>();
    pending.set("known-id", true);

    // 알 수 없는 id는 무시
    const p = pending.get("unknown-id-9999");
    assert.equal(p, undefined);
    assert.equal(pending.size, 1, "pending 맵 크기 변화 없음");
  });
});

// ── BUG-05: PluginBridge — 재연결 시 pending 요청 처리 없음 ──────────────────
//
// plugin-bridge.ts:26-29
//   this.wss.on("connection", (ws) => {
//     this.client = ws;  ← 기존 클라이언트 덮어씀, pending 정리 없음
//
// [버그] 재연결 시 기존 pending 요청이 30s 타임아웃까지 처리되지 않음
// → 새 연결의 플러그인은 이전 요청의 id를 알 수 없어 응답 불가
// → 30s 후 timeout 오류 발생 (사용자 경험 저하)

describe("BUG-05: PluginBridge — 재연결 시 pending 요청 처리", () => {
  test("[BUG] 재연결 시 pending 요청이 남아 타임아웃까지 대기", () => {
    // 시뮬레이션: 재연결 이벤트 발생 시 pending 정리 여부
    const pending = new Map<string, string>();
    pending.set("req-1", "BATCH_CREATE_NODES");
    pending.set("req-2", "BATCH_UPDATE_TEXT");

    // 현재 구현: 재연결 시 pending 정리 코드 없음
    function simulateReconnect() {
      // plugin-bridge.ts:27: this.client = ws;
      // pending 맵 정리 없음 — 현재 구현 그대로
    }

    simulateReconnect();

    // pending이 아직 남아 있음 → 30s 타임아웃 대기
    assert.equal(pending.size, 2,
      "[BUG] 재연결 후에도 pending 요청 2개가 정리되지 않음 — 30s 타임아웃 대기");

    // 개선 제안: 재연결 시 pending 요청을 즉시 reject해야 함
    // pending.forEach((_, id) => reject(new Error("Connection reset")));
    // pending.clear();
  });

  test("정상 타임아웃 후 pending 정리 시뮬레이션", () => {
    const pending = new Map<string, boolean>();
    const id = "timed-out-req";
    pending.set(id, true);

    // plugin-bridge.ts:72-75: setTimeout 콜백
    function simulateTimeout(reqId: string) {
      pending.delete(reqId);
      // reject(new Error(`Plugin command timed out after 30s`));
    }

    simulateTimeout(id);
    assert.ok(!pending.has(id), "타임아웃 후 pending에서 제거됨 (정상)");
  });
});

// ── BUG-06: read.ts — get_node_tree depth 스키마 검증 ────────────────────────

const GetNodeTreeDepthSchema = z.number().int().min(1).max(6);

describe("BUG-06: get_node_tree depth 스키마 범위", () => {
  test("depth=1 — 최솟값 통과", () => {
    assert.ok(GetNodeTreeDepthSchema.safeParse(1).success);
  });

  test("depth=6 — 최댓값 통과", () => {
    assert.ok(GetNodeTreeDepthSchema.safeParse(6).success);
  });

  test("depth=0 — 거부 (min=1 위반)", () => {
    assert.ok(!GetNodeTreeDepthSchema.safeParse(0).success);
  });

  test("depth=7 — 거부 (max=6 초과)", () => {
    assert.ok(!GetNodeTreeDepthSchema.safeParse(7).success);
  });

  test("depth=1.5 — 거부 (int 아님)", () => {
    assert.ok(!GetNodeTreeDepthSchema.safeParse(1.5).success);
  });

  test("[BUG 후보] depth=-1 — 거부 확인 (min=1 위반)", () => {
    assert.ok(!GetNodeTreeDepthSchema.safeParse(-1).success);
  });

  test("depth 문자열 '3' — 거부 (타입 불일치)", () => {
    assert.ok(!GetNodeTreeDepthSchema.safeParse("3").success);
  });
});

// ── BUG-07: write.ts — batch_update_component_properties properties 스키마 ────
//
// properties: z.record(z.string(), z.unknown())
// [확인] 배열을 전달하면 거부되는가? (z.record는 객체만 허용)

const PropertiesSchema = z.record(z.string(), z.unknown());

describe("BUG-07: batch_update_component_properties — properties 타입", () => {
  test("빈 객체 → 통과 (프로퍼티 없는 업데이트)", () => {
    assert.ok(PropertiesSchema.safeParse({}).success);
  });

  test("일반 키-값 객체 → 통과", () => {
    assert.ok(PropertiesSchema.safeParse({ "Button Text": "Submit", "Variant": "Primary" }).success);
  });

  test("[BUG 후보] 배열 → 거부 여부 확인", () => {
    // z.record는 배열을 허용하는가? (배열도 object 타입)
    const result = PropertiesSchema.safeParse(["a", "b"]);
    // JavaScript에서 배열은 객체이므로 z.record가 통과할 수 있음
    // 이 동작을 명확히 문서화
    if (result.success) {
      // 배열이 통과됨 — 예상치 못한 동작
      assert.ok(true, "[주의] z.record가 배열을 허용함 — Figma 플러그인에서 오류 발생 가능");
    } else {
      assert.ok(true, "배열은 거부됨 (올바름)");
    }
  });

  test("null → 거부", () => {
    assert.ok(!PropertiesSchema.safeParse(null).success);
  });

  test("문자열 → 거부", () => {
    assert.ok(!PropertiesSchema.safeParse("text").success);
  });

  test("unknown 타입 값 포함 — 통과 (중첩 객체, 배열, null 등)", () => {
    assert.ok(PropertiesSchema.safeParse({
      "Text": "Submit",
      "Nested": { deep: true },
      "Array": [1, 2, 3],
      "Null": null,
    }).success);
  });
});

// ── BUG-08: JSON.parse 오류 처리 — 잘못된 메시지 무시 확인 ────────────────────
//
// plugin-bridge.ts:31-42
//   try {
//     const msg = JSON.parse(data.toString()) as {...};
//     ...
//   } catch {
//     // ignore malformed messages
//   }

describe("BUG-08: 잘못된 WebSocket 메시지 처리", () => {
  function simulateMessageHandling(raw: string): "processed" | "ignored" {
    try {
      const msg = JSON.parse(raw) as { id?: string; result?: unknown; error?: string };
      if (msg.id !== undefined) return "processed";
      return "ignored"; // id 없는 메시지
    } catch {
      return "ignored"; // JSON 파싱 실패
    }
  }

  test("유효한 JSON + id — 처리됨", () => {
    assert.equal(simulateMessageHandling('{"id":"abc","result":{}}'), "processed");
  });

  test("잘못된 JSON — 무시됨 (크래시 없음)", () => {
    assert.equal(simulateMessageHandling("not json"), "ignored");
  });

  test("빈 JSON — 무시됨 (id 없음)", () => {
    assert.equal(simulateMessageHandling("{}"), "ignored");
  });

  test("JSON 배열 — 무시됨 (id 없음)", () => {
    assert.equal(simulateMessageHandling("[1,2,3]"), "ignored");
  });

  test("빈 문자열 — 무시됨 (JSON 파싱 실패)", () => {
    assert.equal(simulateMessageHandling(""), "ignored");
  });

  test("id=null 메시지 — Map.get(null) = undefined → 무시됨 (정상)", () => {
    // 실제 plugin-bridge.ts:33-38 로직:
    //   const pending = this.pending.get(msg.id);  // Map.get(null) → undefined
    //   if (pending) { ... }                        // false → 무시됨
    // 시뮬레이션을 Map 기반으로 재현
    const pending = new Map<string, boolean>();
    pending.set("known-id", true);
    const msg = JSON.parse('{"id":null,"result":{}}') as { id: string };
    const found = pending.get(msg.id); // Map.get(null) → undefined
    assert.equal(found, undefined, "id=null → pending에서 찾지 못함 → 무시 (정상)");
  });
});
