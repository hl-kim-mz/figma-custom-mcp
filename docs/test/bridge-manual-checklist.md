# Bridge / Write Tool 수동 테스트 체크리스트

**ATL-501 산출물** | 관련 Epic: ATL-500

브릿지 연결이 필요한 tool은 자동화 불가 → 이 체크리스트로 수동 검증.

## 사전 조건

- [ ] figma-custom-mcp 서버 기동: `npm run build && node dist/index.js`
- [ ] Figma 앱 실행 → Plugins > Development > figma-custom-mcp 실행
- [ ] Claude Code / MCP 클라이언트에서 `plugin_status` 호출 → `connected: true` 확인

---

## TC-B01~06: Bridge Read Tools

### TC-B01: plugin_status — 연결 상태
```
호출: plugin_status()
기대: { connected: true, unsafeMode: false, message: "Bridge Plugin connected..." }
```
- [ ] PASS / [ ] FAIL — 비고:

### TC-B02: plugin_status — 미연결 상태
```
조건: Figma 플러그인 종료 후 호출
기대: { connected: false, message: "Not connected. Open Figma..." }
```
- [ ] PASS / [ ] FAIL — 비고:

### TC-B03: get_node_tree — 정상 호출
```
호출: get_node_tree({ depth: 2 })
기대: 현재 Figma 페이지의 노드 트리 JSON 반환
```
- [ ] PASS / [ ] FAIL — 비고:

### TC-B04: get_node_tree — 미연결 상태
```
조건: 플러그인 미실행
기대: error: "Bridge Plugin not connected..." 메시지 (크래시 없음)
```
- [ ] PASS / [ ] FAIL — 비고:

### TC-B05: inspect_scope_tree — 유효한 scope
```
호출: inspect_scope_tree({ file_key: "...", scope_node_id: "<FRAME_ID>" })
기대: descendants, isAllowedParent 등 포함된 서브트리 JSON
```
- [ ] PASS / [ ] FAIL — 비고:

### TC-B06: inspect_scope_tree — 미연결
```
조건: 플러그인 미실행
기대: { code: "BRIDGE_NOT_CONNECTED" }
```
- [ ] PASS / [ ] FAIL — 비고:

---

## TC-W01~09: Write Tools

> ⚠ 모든 Write 조작은 테스트 전용 Figma 파일에서 수행할 것.

### TC-W01: batch_create_nodes — FRAME 생성
```
호출: batch_create_nodes({
  file_key: "...",
  scope_node_id: "<FRAME_ID>",
  operations: [{ type: "FRAME", parent_node_id: "<PARENT>", name: "TC-W01-Frame", x: 0, y: 0, width: 100, height: 100 }]
})
기대: 성공 응답, Figma Layers 패널에 "TC-W01-Frame" 노드 확인
```
- [ ] PASS / [ ] FAIL — 비고:

### TC-W02: batch_create_nodes — TEXT + characters
```
operations: [{ type: "TEXT", parent_node_id: "<PARENT>", name: "TC-W02-Text", characters: "Hello QA" }]
기대: "Hello QA" 텍스트 노드 생성
```
- [ ] PASS / [ ] FAIL — 비고:

### TC-W03: batch_create_instances — 컴포넌트 인스턴스
```
조건: 로컬 COMPONENT 노드 ID 사전 확인 (list_components 또는 find_node 사용)
기대: 인스턴스 생성 성공
```
- [ ] PASS / [ ] FAIL — 비고:

### TC-W03-NEG: batch_create_instances — 비컴포넌트 소스 노드 오류 [QA 조건]
```
조건: source_component_node_id에 COMPONENT가 아닌 노드 ID 전달
  - 케이스 A: 존재하는 RECTANGLE 노드 ID
  - 케이스 B: 존재하는 FRAME 노드 ID
  - 케이스 C: 존재하지 않는 임의 ID (예: "99999:99999")
기대:
  - Figma 캔버스에 인스턴스가 생성되지 않아야 함
  - 플러그인이 오류 응답 반환 (NODE_NOT_COMPONENT 또는 NODE_NOT_FOUND)
  - MCP 서버 크래시 없이 에러 메시지 구조 반환
주의: "empty rectangle" 등 메타데이터 없는 임의 노드 생성은 오류로 처리해야 함
```
- [ ] PASS / [ ] FAIL — 비고 (케이스 A):
- [ ] PASS / [ ] FAIL — 비고 (케이스 B):
- [ ] PASS / [ ] FAIL — 비고 (케이스 C):

### TC-W04: batch_update_geometry — 위치/크기 변경
```
operations: [{ node_id: "<NODE>", x: 50, y: 50, width: 200, height: 200 }]
기대: 노드 좌표 변경 확인
```
- [ ] PASS / [ ] FAIL — 비고:

### TC-W05: batch_update_auto_layout — HORIZONTAL 설정
```
operations: [{ node_id: "<FRAME>", layout_mode: "HORIZONTAL", item_spacing: 8 }]
기대: Auto Layout 방향 변경 확인
```
- [ ] PASS / [ ] FAIL — 비고:

### TC-W06: batch_update_text — 텍스트 + 폰트
```
operations: [{ node_id: "<TEXT>", characters: "Updated", font_size: 16 }]
기대: 텍스트 내용 및 폰트 크기 반영
```
- [ ] PASS / [ ] FAIL — 비고:

### TC-W07: batch_update_fills_strokes_effects — fill 색상
```
operations: [{ node_id: "<NODE>", fills: [{ type: "SOLID", color: { r: 1, g: 0, b: 0, a: 1 } }] }]
기대: 빨간색 fill 반영
```
- [ ] PASS / [ ] FAIL — 비고:

### TC-W08: batch_bind_variables — 변수 바인딩
```
조건: Figma 파일에 로컬 변수 존재
operations: [{ node_id: "<NODE>", bindings: [{ property: "opacity", variable_id: "<VAR_ID>" }] }]
기대: opacity에 변수 바인딩 확인
```
- [ ] PASS / [ ] FAIL — 비고:

### TC-W09: batch_reorder_move — 레이어 순서 변경
```
operations: [{ node_id: "<NODE>", new_index: 0 }]
기대: Layers 패널에서 순서 변경 확인
```
- [ ] PASS / [ ] FAIL — 비고:

---

## TC-E02~05: 에러/엣지케이스 (수동)

### TC-E02: 스코프 외 노드 ID
```
scope_node_id와 다른 트리의 node_id 사용
기대: OUT_OF_SCOPE_NODE 에러
```
- [ ] PASS / [ ] FAIL — 비고:

### TC-E03: TEXT 아닌 노드에 batch_update_text
```
FRAME node_id로 batch_update_text 호출
기대: INVALID_NODE_TYPE 에러
```
- [ ] PASS / [ ] FAIL — 비고:

### TC-E04: operations 101개 배열
```
기대: Zod validation 에러 (max 100)
```
- [ ] PASS / [ ] FAIL — 비고:

### TC-E05: MCP 서버 재시작 후 재연결
```
서버 재시작 → 플러그인 재연결 → plugin_status 호출
기대: connected: true 정상 복구
```
- [ ] PASS / [ ] FAIL — 비고:

---

## 결과 집계

| 구분 | 총 TC | PASS | FAIL | SKIP |
|------|-------|------|------|------|
| Bridge Read | 6 | | | |
| Write | 9 | | | |
| Write-NEG (비컴포넌트 인스턴스) | 3 | | | |
| 에러/엣지 | 4 | | | |
| **합계** | **22** | | | |

> **[QA 조건] TC-W03-NEG**: `batch_create_instances` 호출 시 `source_component_node_id`가
> 실제 COMPONENT 타입 노드가 아닌 경우(빈 직사각형, FRAME, RECTANGLE 등) 반드시 오류를
> 반환해야 하며, 캔버스에 아무 노드도 생성되지 않아야 한다.

완료 후 → ATL-502 (기능 테스트 실행) 진행
