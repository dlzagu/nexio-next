# ADR-0003: shadcn/ui CLI 대신 Radix 프리미티브 + 자체 CSS 레이어

- 날짜: 2026-07-30
- 상태: 채택

## 맥락 (왜 이 결정이 필요했나)

`tech-stack.md` 는 스택을 "Next.js + TypeScript + Tailwind + **shadcn/ui**" 로 잡았다.
그런데 P3 에서 나온 디자인 시스템은 **자체 토큰 168개**(`tokens.css`)와 컴포넌트 14종
스펙(`styleguide.html`)을 이미 갖고 있다.

`styleguide.html` 을 열어 보니 재사용할 CSS 클래스 레이어가 없다 — 템플릿 엔진 아티팩트에
**토큰 기반 인라인 스타일**만 들어 있다(`style="height:var(--row-h); font-size:var(--fs-13)"`).
즉 값은 정확히 정해져 있고, 그걸 담을 코드가 없는 상태다.

`shadcn init` 을 돌리면 `globals.css` 를 자체 CSS 변수 체계(`--background`, `--primary` …)로
덮어쓰고, 컴포넌트마다 그 변수를 참조한다. 우리 토큰 체계와 이름·구조가 모두 달라
**받아온 컴포넌트를 100% 다시 칠해야** 한다.

## 결정

shadcn/ui CLI 와 레지스트리는 쓰지 않는다. 대신:

1. **접근성이 어려운 것은 Radix 프리미티브를 직접 쓴다** — `react-dialog`(Sheet/Modal),
   `react-tabs`, `react-popover`(Combobox). 포커스 트랩·Esc·스크롤 락·ARIA 는 직접 짜면
   반드시 빠뜨린다.
2. **스타일은 `globals.css` 의 LAYER 2 클래스로** 고정한다(`.btn` `.input` `.tbl` `.stp` …).
   수치는 전부 `var(--*)` 참조 — 토큰을 바꾸면 전 화면이 따라 바뀐다.
3. `@theme inline` 으로 토큰을 Tailwind 유틸로도 노출한다(`bg-surface`, `text-13`).
   `inline` 이라 `[data-theme="dark"]` 전환이 유틸에도 적용된다.

shadcn 이 하는 일과 실질적으로 같다(Radix + Tailwind). CLI·레지스트리 단계만 빼고
우리 토큰을 1급으로 둔 것이다.

## 결과 (트레이드오프)

- **얻는 것**: 토큰이 단일 정본이다. 재작업(받아온 스타일을 걷어내는 일)이 없다.
  다크·라이트·밀도 3단계가 클래스 한 곳에서 처리된다.
- **포기하는 것**: shadcn 레지스트리의 기성 컴포넌트를 `npx` 한 줄로 가져오는 편의.
  새 컴포넌트가 필요하면 Radix 프리미티브 위에 직접 만들어야 한다.
- `tech-stack.md` 의 "shadcn/ui" 표기와 어긋난다 → 이 ADR 이 그 항목을 대체한다.

## 검토한 대안

- **`shadcn init` 후 전면 오버라이드** — 탈락: 두 개의 색 체계(`--primary` vs `--accent-solid`)가
  공존하게 되고, 어느 쪽이 정본인지 매번 헷갈린다. 오버라이드 누락이 곧 디자인 붕괴다.
- **Radix 없이 전부 자체 구현** — 탈락: Sheet 의 포커스 트랩·Combobox 의 키보드 내비게이션은
  직접 짜면 접근성이 깨진다. `ux-principles.md` 는 색 대비까지 검증한 문서다 — 그 수준을
  키보드 접근성에서 포기할 이유가 없다.

## 관련

- `docs/design/tokens.css`(정본) → `src/app/tokens.css`(복사본, 손대지 않음)
- `src/app/globals.css` LAYER 2 — 컴포넌트 클래스
- `/styleguide` — 실제 코드가 그리는 결과를 확인하는 살아있는 스타일가이드
