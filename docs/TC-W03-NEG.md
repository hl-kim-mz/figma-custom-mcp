# TC-W03-NEG: batch_create_instances — 비컴포넌트 소스 노드 런타임 거부 검증

**범주**: Write Tool 수동 브릿지 테스트 (Negative)
**대상 도구**: `batch_create_instances`
**관련 자동화 TC**: TC-REG-08 (`src/__tests__/regression.test.ts:448`)
**실행 조건**: Figma Bridge Plugin 연결 필수 (자동화 불가 — 플러그인 런타임 검증)

---

## 전제 조건

- [ ] Figma 파일이 열려 있고 Bridge Plugin 실행 중 (`Plugins > Development > figma-custom-mcp bridge`)
- [ ] `plugin_status` 호출 시 `connected: true` 확인
- [ ] 테스트용 Figma 파일에 아래 노드가 존재함:
  - **RECTANGLE 노드**: ID 기록란 → `_______________________`
  - **FRAME 노드**: ID 기록란 → `_______________________`
  - **INSTANCE 노드** (기존 컴포넌트의 인스턴스): ID 기록란 → `_______________________`
  - **유효한 COMPONENT 노드** (양성 대조군): ID 기록란 → `_______________________`
  - **스코프 FRAME 노드** (scope_node_id): ID 기록란 → `_______________________`
  - **부모 FRAME 노드** (parent_node_id, 스코프 내부): ID 기록란 → `_______________________`

> 노드 ID 확인: Figma 레이어 패널에서 노드 우클릭 → "Copy link to selection", 또는 `get_node_tree` 호출로 추출

---

## TC-W03-NEG-01: RECTANGLE 노드를 소스로 전달

**입력**:
```json
{
  "file_key": "<FILE_KEY>",
  "scope_node_id": "<SCOPE_FRAME_ID>",
  "operations": [{
    "source_component_node_id": "<RECTANGLE_NODE_ID>",
    "parent_node_id": "<PARENT_FRAME_ID>",
    "x": 0,
    "y": 0
  }]
}
```

**예상 결과**:
- 플러그인이 오류 응답 반환 (예: `NODE_NOT_COMPONENT`, `Invalid source node type`, 또는 동등한 에러)
- Figma 캔버스에 인스턴스가 생성되지 않음
- 기존 캔버스 상태 변경 없음 (all-or-nothing 보장)

**실제 결과**:
- [ ] PASS — 오류 반환, 인스턴스 미생성
- [ ] FAIL — 인스턴스 생성됨 (버그)
- [ ] FAIL — 다른 오류 반환

**오류 메시지 기록**: `_____________________________________________`

---

## TC-W03-NEG-02: FRAME 노드를 소스로 전달

**입력**:
```json
{
  "file_key": "<FILE_KEY>",
  "scope_node_id": "<SCOPE_FRAME_ID>",
  "operations": [{
    "source_component_node_id": "<FRAME_NODE_ID>",
    "parent_node_id": "<PARENT_FRAME_ID>",
    "x": 0,
    "y": 0
  }]
}
```

**예상 결과**:
- 플러그인 오류 반환 (FRAME은 COMPONENT가 아님)
- 캔버스 변경 없음

**실제 결과**:
- [ ] PASS — 오류 반환, 인스턴스 미생성
- [ ] FAIL — 인스턴스 생성됨 (버그)

**오류 메시지 기록**: `_____________________________________________`

---

## TC-W03-NEG-03: INSTANCE 노드를 소스로 전달

**입력**:
```json
{
  "file_key": "<FILE_KEY>",
  "scope_node_id": "<SCOPE_FRAME_ID>",
  "operations": [{
    "source_component_node_id": "<INSTANCE_NODE_ID>",
    "parent_node_id": "<PARENT_FRAME_ID>",
    "x": 0,
    "y": 0
  }]
}
```

**예상 결과**:
- 플러그인 오류 반환 (INSTANCE는 COMPONENT가 아님 — 중첩 인스턴스 생성 방지)
- 캔버스 변경 없음

> **참고**: Figma API는 INSTANCE의 `mainComponent`를 통해 COMPONENT를 역참조할 수 있으나, 해당 플러그인은 직접 COMPONENT ID를 요구함

**실제 결과**:
- [ ] PASS — 오류 반환, 인스턴스 미생성
- [ ] FAIL — 인스턴스 생성됨 (버그)
- [ ] AMBIGUOUS — mainComponent 역참조 후 생성됨 (동작 정의 필요)

**오류 메시지 기록**: `_____________________________________________`

---

## TC-W03-NEG-04: 빈 문자열 source_component_node_id

**입력**:
```json
{
  "file_key": "<FILE_KEY>",
  "scope_node_id": "<SCOPE_FRAME_ID>",
  "operations": [{
    "source_component_node_id": "",
    "parent_node_id": "<PARENT_FRAME_ID>"
  }]
}
```

**예상 결과**:
- `NODE_NOT_FOUND` 또는 유사한 오류 반환 (스키마는 통과, 런타임에서 거부)
- 캔버스 변경 없음

**실제 결과**:
- [ ] PASS — 오류 반환 (NODE_NOT_FOUND 또는 유사)
- [ ] FAIL — 크래시 또는 예외 없이 무반응
- [ ] FAIL — 인스턴스 생성됨

**오류 메시지 기록**: `_____________________________________________`

---

## TC-W03-NEG-05: 존재하지 않는 노드 ID

**입력**:
```json
{
  "file_key": "<FILE_KEY>",
  "scope_node_id": "<SCOPE_FRAME_ID>",
  "operations": [{
    "source_component_node_id": "9999:9999",
    "parent_node_id": "<PARENT_FRAME_ID>"
  }]
}
```

**예상 결과**:
- `NODE_NOT_FOUND` 오류 반환
- 캔버스 변경 없음

**실제 결과**:
- [ ] PASS — NODE_NOT_FOUND 오류 반환
- [ ] FAIL — 다른 오류 또는 크래시

**오류 메시지 기록**: `_____________________________________________`

---

## TC-W03-NEG-06: 양성 대조군 — 유효한 COMPONENT 노드 (정상 동작 확인)

**입력**:
```json
{
  "file_key": "<FILE_KEY>",
  "scope_node_id": "<SCOPE_FRAME_ID>",
  "operations": [{
    "source_component_node_id": "<VALID_COMPONENT_ID>",
    "parent_node_id": "<PARENT_FRAME_ID>",
    "x": 100,
    "y": 100
  }]
}
```

**예상 결과**:
- 성공 응답 반환
- Figma 캔버스에 인스턴스 생성 확인

**실제 결과**:
- [ ] PASS — 인스턴스 생성 확인
- [ ] FAIL — 오류 반환 (환경 문제 가능성)

---

## 검증 요약

| TC ID | 입력 케이스 | 예상 | 실제 | 판정 |
|---|---|---|---|---|
| NEG-01 | RECTANGLE 소스 | 오류 반환 | | |
| NEG-02 | FRAME 소스 | 오류 반환 | | |
| NEG-03 | INSTANCE 소스 | 오류 반환 | | |
| NEG-04 | 빈 문자열 ID | NODE_NOT_FOUND | | |
| NEG-05 | 존재하지 않는 ID | NODE_NOT_FOUND | | |
| NEG-06 | 유효한 COMPONENT (대조군) | 인스턴스 생성 | | |

**최종 판정**: [ ] ALL PASS  [ ] FAIL (케이스: _______)

**테스트 일시**: ___________  **테스터**: ___________  **Figma 파일**: ___________
