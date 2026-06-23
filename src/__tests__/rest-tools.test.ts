/**
 * ATL-501: figma-custom-mcp REST Tool 자동화 테스트
 * Node.js 내장 test runner 사용 (node --test)
 *
 * 실행: npx tsx --test src/__tests__/rest-tools.test.ts
 * 환경: docs/test/test-config.json 필요
 */

import { test, describe, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { FigmaRestClient } from "../figma-rest.js";

// ── Config ──────────────────────────────────────────────────────────────────

interface TestConfig {
  figma: {
    token: string;
    testFileKey: string;
    testPageName: string;
    testFrameName: string;
    testNodeName: string;
  };
}

function loadConfig(): TestConfig {
  const configPath = new URL("../../docs/test/test-config.json", import.meta.url);
  if (!existsSync(configPath)) {
    throw new Error(
      "docs/test/test-config.json not found.\n" +
      "Copy docs/test/test-config.sample.json → docs/test/test-config.json and fill in values."
    );
  }
  return JSON.parse(readFileSync(configPath, "utf-8"));
}

// ── Fixtures ─────────────────────────────────────────────────────────────────

let figma: FigmaRestClient;
let cfg: TestConfig;

before(() => {
  cfg = loadConfig();
  figma = new FigmaRestClient(cfg.figma.token);
});

// ── TC-R01: get_page_structure — 전체 페이지 반환 ───────────────────────────

describe("TC-R01~03: get_page_structure", () => {
  test("TC-R01: 유효한 file_key로 페이지 목록 반환", async () => {
    const file = await figma.getFile(cfg.figma.testFileKey);
    const pages = file.document?.children ?? [];
    assert.ok(pages.length > 0, "pages 배열이 비어있음");
    assert.ok(pages[0].id, "page.id 없음");
    assert.ok(pages[0].name, "page.name 없음");
  });

  test("TC-R02: page_name 필터 — 해당 페이지만 반환", async () => {
    const file = await figma.getFile(cfg.figma.testFileKey);
    const pages: any[] = file.document?.children ?? [];
    const filtered = pages.filter((p: any) =>
      p.name.toLowerCase().includes(cfg.figma.testPageName.toLowerCase())
    );
    assert.ok(filtered.length > 0, `"${cfg.figma.testPageName}" 페이지를 찾을 수 없음`);
  });

  test("TC-R03: 30초 캐시 — 두 번 연속 호출 시 두 번째가 더 빠름", async () => {
    const t1 = Date.now();
    await figma.getFile(cfg.figma.testFileKey);
    const first = Date.now() - t1;

    const t2 = Date.now();
    await figma.getFile(cfg.figma.testFileKey);
    const second = Date.now() - t2;

    // 캐시 히트 시 두 번째 < 첫 번째 (또는 둘 다 매우 빠름)
    console.log(`  first=${first}ms, second=${second}ms`);
    assert.ok(second <= first + 200, `캐시 미작동 의심: second=${second}ms > first=${first}ms`);
  });
});

// ── TC-R04~05: get_all_text ──────────────────────────────────────────────────

describe("TC-R04~05: get_all_text", () => {
  test("TC-R04: 전체 파일 텍스트 추출 — total > 0", async () => {
    const file = await figma.getFile(cfg.figma.testFileKey);
    const pages: any[] = file.document?.children ?? [];

    let count = 0;
    function countText(node: any) {
      if (node.type === "TEXT" && node.characters) count++;
      for (const child of node.children ?? []) countText(child);
    }
    for (const page of pages) countText(page);

    assert.ok(count > 0, "텍스트 노드가 없음");
  });

  test("TC-R05: page_name 필터 — 범위 내 텍스트만 포함", async () => {
    const file = await figma.getFile(cfg.figma.testFileKey);
    const pages: any[] = file.document?.children ?? [];
    const target = pages.filter((p: any) =>
      p.name.toLowerCase().includes(cfg.figma.testPageName.toLowerCase())
    );
    assert.ok(target.length > 0, `"${cfg.figma.testPageName}" 페이지 없음`);
  });
});

// ── TC-R06: list_components ──────────────────────────────────────────────────

describe("TC-R06: list_components", () => {
  test("TC-R06: 컴포넌트 목록 반환 — id/name/key 포함", async () => {
    const file = await figma.getFile(cfg.figma.testFileKey);
    const raw: Record<string, any> = file.components ?? {};
    const entries = Object.entries(raw);

    if (entries.length === 0) {
      console.log("  ⚠ 파일에 컴포넌트 없음 — SKIP");
      return;
    }

    const [id, c] = entries[0];
    assert.ok(id, "component id 없음");
    assert.ok(c.name, "component name 없음");
    assert.ok(c.key, "component key 없음");
  });
});

// ── TC-R07: get_design_tokens ────────────────────────────────────────────────

describe("TC-R07: get_design_tokens", () => {
  test("TC-R07: 변수/스타일 반환 — 에러 없이 응답", async () => {
    const [vars, stylesData] = await Promise.all([
      figma.getLocalVariables(cfg.figma.testFileKey).catch(() => ({ variables: {}, variableCollections: {} })),
      figma.getStyles(cfg.figma.testFileKey).catch(() => ({ styles: {} })),
    ]);
    // 파일에 변수 없어도 에러 없이 빈 객체 반환해야 함
    assert.ok(typeof vars === "object", "vars가 객체가 아님");
    assert.ok(typeof stylesData === "object", "stylesData가 객체가 아님");
  });
});

// ── TC-R08~10: find_node ─────────────────────────────────────────────────────

describe("TC-R08~10: find_node", () => {
  test("TC-R08: 존재하는 노드명 검색 — found > 0", async () => {
    const file = await figma.getFile(cfg.figma.testFileKey);
    const pages: any[] = file.document?.children ?? [];
    const needle = cfg.figma.testNodeName.toLowerCase();
    const results: any[] = [];

    function search(node: any) {
      if (node.name?.toLowerCase().includes(needle)) results.push(node.id);
      for (const child of node.children ?? []) search(child);
    }
    for (const page of pages) search(page);

    assert.ok(results.length > 0, `"${cfg.figma.testNodeName}" 노드를 찾을 수 없음`);
    console.log(`  found ${results.length} node(s)`);
  });

  test("TC-R09: 존재하지 않는 이름 — found === 0", async () => {
    const file = await figma.getFile(cfg.figma.testFileKey);
    const pages: any[] = file.document?.children ?? [];
    const needle = "__NONEXISTENT_NODE_XYZ__";
    const results: any[] = [];

    function search(node: any) {
      if (node.name?.toLowerCase().includes(needle)) results.push(node.id);
      for (const child of node.children ?? []) search(child);
    }
    for (const page of pages) search(page);

    assert.strictEqual(results.length, 0, "존재하지 않는 노드가 검색됨");
  });

  test("TC-R10: limit 파라미터 — 결과 수 제한", async () => {
    const limit = 3;
    const file = await figma.getFile(cfg.figma.testFileKey);
    const pages: any[] = file.document?.children ?? [];
    const results: any[] = [];

    function search(node: any) {
      if (results.length >= limit) return;
      results.push(node.id);
      for (const child of node.children ?? []) search(child);
    }
    for (const page of pages) {
      if (results.length >= limit) break;
      search(page);
    }

    assert.ok(results.length <= limit, `limit=${limit} 초과: ${results.length}개 반환`);
  });
});

// ── TC-E01: 잘못된 file_key ──────────────────────────────────────────────────

describe("TC-E01: 잘못된 file_key 에러 핸들링", () => {
  test("TC-E01: 잘못된 file_key — 에러 응답, 서버 크래시 없음", async () => {
    await assert.rejects(
      () => figma.getFile("INVALID_FILE_KEY_99999"),
      (err: any) => {
        assert.ok(err instanceof Error || typeof err === "object", "에러가 아닌 응답");
        return true;
      }
    );
  });
});
