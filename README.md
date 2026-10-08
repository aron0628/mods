# mods

Claude Code 개인 mod 모음. mod 하나가 `<이름>/` 폴더 하나다. mod마다 별개 플러그인이라
필요한 것만 골라 설치한다.

## 수록 mod

| mod | 하는 일 |
|---|---|
| [`mermaid-box`](mermaid-box/) | Claude 답변의 ` ```mermaid ` 블록을 터미널에서 박스 그림으로 그린다. 한글 라벨 정렬 보정 포함. |
| [`command-guard`](command-guard/) | 설정에 적은 패턴이 든 셸 명령과 Co-Authored-By 가 붙은 git 커밋을 실행 전에 막는다. bypass 모드에서도 막힌다. |
| [`omf-panel`](omf-panel/) | `/omf-panel` 로 omf 진행 중 task 의 단계(01~05)와 계획 승인 여부를 옆 패널에 보여 준다. |

## 요구 사항

- Claude Code 2.1.287 이상 (mod 기능이 들어간 버전)
- 터미널에서 실행한 Claude Code. 데스크톱 앱, VS Code, `claude -p` 에서는 아무것도 바꾸지 않는다.

## 설치

```
/plugin marketplace add aron0628/mods
/plugin install mermaid-box@mods
/plugin install command-guard@mods
/plugin install omf-panel@mods
```

첫 줄은 한 번만 하면 된다. 나머지는 쓸 mod 만 고른다. 설치한 mod 는 `/plugin` 메뉴에서 끄거나 지울 수 있다.

업데이트:

```
/plugin marketplace update mods
```

mod 는 내 컴퓨터에서 Claude Code 와 같은 권한으로 도는 코드다. 설치 전에 코드를 읽어 보는 게 좋다.

### 직접 설치 (mod 를 고쳐 가며 쓸 때)

로컬 폴더를 marketplace 로 추가하면 설치본이 복사본이 아니라 그 폴더를 직접 읽는다.
고친 뒤 `/reload-plugins` 한 번이면 반영된다.

```bash
git clone https://github.com/aron0628/mods.git ~/dev/mods
claude plugin marketplace add ~/dev/mods
claude plugin install mermaid-box@mods --scope user
```

GitHub 쪽과 이름이 같으므로(`mods`) 둘 중 하나만 추가한다.

## mermaid-box

Claude 답변이 화면에 그려질 때 닫힌 ` ```mermaid ` 블록을 박스 그림으로 바꾼다. 화면만
바뀌고 저장된 답변은 원문 그대로다(ctrl+o 로 원문 확인). 모델을 부르지 않으므로 토큰을
쓰지 않는다.

- mod 가 켜진 터미널 세션에서는 시스템 프롬프트에 "mermaid 로 그려도 된다"는 짧은 안내가 붙는다.
- 그리는 종류: flowchart(graph), sequenceDiagram, stateDiagram-v2, classDiagram, erDiagram
- 원문 블록을 그대로 두는 경우: 스트리밍 중이라 블록이 아직 안 닫힘, 렌더러가 모르는 종류(gantt 등), 터미널보다 넓은 그림
- 한글: 라벨 안의 한글은 정렬을 맞춰 그린다. 노드 이름 자체를 한글로 쓰면(`요청 --> 저장`)
  렌더러가 그리지 못하므로 `A[요청] --> B[저장]` 처럼 쓴다.

## command-guard

Claude 가 셸 명령(Bash, Monitor)을 실행하기 직전에 명령 글자를 보고, 아래에 걸리면 실행하지
않는다. Claude 는 막힌 이유를 오류로 받는다. 권한 모드와 상관없이 막으므로 bypass 모드에서도,
다른 탭·서브에이전트에서 실행한 명령도 막힌다.

- **설정한 패턴**: 명령에 패턴이 맞으면 막는다. 정규식 하나(여러 조건은 `|` 로 잇는다), 대소문자 구분 없음.
- **Co-Authored-By 커밋**: `git commit` 명령에 `Co-Authored-By:` 가 있거나, `-F`/`--file` 로 넘긴
  메시지 파일에 있으면 막는다. 설정 없이 항상 켜져 있다.

설정은 `/config` 에서 하거나 아래처럼 넣는다. 막을 단어는 저장소가 아니라 내 설정 파일에만 남는다.

```bash
claude plugin configure command-guard@mods --values-stdin <<'EOF'
{
  "blockedPattern": "(^|[\\s;&|(])ENV=[\"']?prod\\b|\\bmake\\s+prod\\b|PROD_SCHEMA",
  "blockedReason": "운영 DB 접근 금지. 실행할 SQL 을 사용자에게 주고 결과를 받는다."
}
EOF
```

`blockedReason` 에는 막힌 뒤 Claude 가 대신 할 일을 적어 두면 좋다.

한계:

- 명령 글자만 본다. 스크립트 파일 안에서 하는 일, 명령에 드러나지 않은 환경 변수는 보지 못한다.
- `cd` 뒤에 상대 경로로 넘긴 메시지 파일은 읽지 못해 통과시킨다.
- 파일을 고치는 도구(Edit, Write)는 대상이 아니다.
- 패턴이 정규식으로 읽히지 않으면 설정을 고칠 때까지 모든 명령을 막는다.

## omf-panel

`/omf-panel` 을 치면 옆 패널에 진행 중인 omf task 를 보여 주고, 열려 있는 동안 5초마다 다시 읽는다.

```
my-repo
  20261008-foo
    01 계획  ✓ APPROVED
    02 개발  ✓
    03 리뷰  -
    04 검증  -
    05 완료  -
```

- 진행 중 task: `.harness/active-plans/<id>` 마커와 `docs/plans/active/<id>/` 폴더
- 산출물은 `.worktrees/<id>/docs/plans/active/<id>/` 를 먼저 보고, 없으면 메인 체크아웃의
  `docs/plans/active/<id>/` 를 본다
- 01 은 `## Status:` 값(DRAFT/APPROVED)을 함께 보여 준다. 경량 경로(`.light`)는 03·05 를 "경량 생략" 으로 표시한다
- 03 리뷰보다 02 개발 로그가 늦게 바뀌었으면(04 검증 전) 03 에 "수정 중 (재리뷰 전)" 을 붙인다.
  재리뷰가 리뷰 파일에 덧붙으면 사라진다. 파일 시각으로 보므로 수정을 마치고 재리뷰를 기다리는
  동안에도 같은 표시가 난다
- 세션 폴더가 레포가 아니면 두 단계 아래까지 `.harness` 가 있는 폴더를 모두 보여 준다.
  worktree 안에서 연 세션은 원래 레포를 기준으로 읽는다

리뷰의 CRITICAL/HIGH 개수는 보여 주지 않는다. 재리뷰 결론의 형식이 정해져 있지 않아 지난 회차
숫자를 읽을 수 있어서다.

## 구조

```
.claude-plugin/
└── marketplace.json        ← 어떤 mod 를 내놓을지 선언

mermaid-box/                ← mod 하나 = 플러그인 하나
├── .claude-plugin/plugin.json
├── hooks/
│   ├── hooks.json          진입 모듈 지정
│   ├── register.ts         본체
│   └── vendor/             번들한 렌더러(beautiful-mermaid) + 라이선스
├── tests/register.test.ts
└── package.json            렌더러를 다시 번들할 때만 사용

command-guard/, omf-panel/  ← 같은 구성 (vendor·package.json 없음)
```

## 새 mod 추가

1. `<이름>/` 에 `.claude-plugin/plugin.json`, `hooks/hooks.json`, `hooks/register.ts` 를 만든다
2. `.claude-plugin/marketplace.json` 의 `plugins` 배열에 항목을 추가한다

```json
{
  "name": "<이름>",
  "description": "이 mod 가 하는 일. 설치 목록에 이 문장이 보인다",
  "version": "0.1.0",
  "source": "./<이름>"
}
```

**2번을 빼먹으면 폴더가 있어도 `/plugin install` 목록에 뜨지 않는다.**

## 개발

```bash
claude plugin validate .              # marketplace, 매니페스트, hooks 모듈
claude plugin test ./<mod>            # 그 mod 의 tests/*.test.ts
claude --plugin-dir ./<mod>           # 그 세션에서만 원본 폴더로 실행
```

렌더러를 갱신할 때 (beautiful-mermaid 버전을 올릴 때):

```bash
cd mermaid-box
npm install
npm run build:vendor
```

## 라이선스

MIT. [`LICENSE`](LICENSE) 참고.

### 제3자 저작물

`mermaid-box/hooks/vendor/mermaid-ascii.js` 는 beautiful-mermaid 1.1.3 의 `src/ascii` 를
esbuild 로 묶은 것이다. 수정하지 않았다. 한글 정렬 보정은 `register.ts` 가 렌더러 앞뒤에서 한다.

> **beautiful-mermaid** · https://github.com/lukilabs/beautiful-mermaid
> Copyright (c) 2026 Craft Docs · MIT License

원본 라이선스 전문은 [`mermaid-box/hooks/vendor/LICENSE-beautiful-mermaid`](mermaid-box/hooks/vendor/LICENSE-beautiful-mermaid)
에 있다. MIT 조건에 따라 이 고지를 유지한다. 이 저장소를 재배포하는 쪽도 같다.
