#!/bin/sh
# PostToolUse(Bash|PowerShell) — 의존성을 바꾼 직후 package-lock.json 을 보정한다.
#
# 왜 훅인가: Windows npm 은 wasm32-wasi optional 패키지의 하위 의존성
#   (@emnapi/core·runtime)을 lock 에 적지 않는다. Linux CI 의 `npm ci` 는 그 항목을
#   요구하므로 즉시 실패한다. 손으로 채워 넣어도 다음 `npm install` 이 다시 지운다
#   — 실제로 2회 재발했고 그때마다 CI 가 죽었다. 사람 기억에 맡기지 않는다.
#
# 계약: PostToolUse 는 차단할 수 없다 → 무슨 일이 있어도 exit 0.
#       실제로 보정했을 때만 JSON 을 출력해 사용자와 Claude 에게 알린다
#       (커밋에 lock 을 포함해야 하므로 조용히 넘어가면 안 된다).

payload=$(cat)

root=${CLAUDE_PROJECT_DIR:-.}
fixer="$root/scripts/sync-lock-wasm-deps.mjs"

[ -f "$fixer" ] || exit 0
[ -f "$root/package-lock.json" ] || exit 0
command -v node >/dev/null 2>&1 || exit 0

# lock 을 다시 쓰는 npm 하위명령만 대상. `npm ci` 는 lock 을 읽기만 하므로 제외하고,
# `npm run *` 도 제외한다 (alternation 순서상 install 이 i 보다 먼저 시도된다).
# 선행문자에 따옴표(")를 포함하는 이유: jq 부재 시 폴백이 JSON 원문을 훑는데
# 거기서는 명령이 `"command":"npm install ...` 처럼 따옴표 뒤에 온다.
NPM_WRITES_LOCK='(^|[;&|"]|[[:space:]])npm[[:space:]]+(install|i|add|uninstall|remove|rm|un|update|up|dedupe|prune)([[:space:]]|$)'

if command -v jq >/dev/null 2>&1; then
  cmd=$(printf '%s' "$payload" | jq -r '.tool_input.command // empty')
else
  # jq 부재 시(이 프로젝트의 Git Bash 가 그렇다) sed 로 command 를 뽑는다.
  # 실패하면 원문 전체로 떨어뜨린다 — 과탐 방향으로만 틀리고, 보정은 멱등이라
  # 헛돌아도 "lock 정상" 을 찍고 끝난다 (block-dangerous-bash.sh 와 같은 판단).
  cmd=$(printf '%s' "$payload" \
    | sed -n 's/.*"command"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n 1)
  [ -n "$cmd" ] || cmd=$payload
fi

[ -n "$cmd" ] || exit 0
printf '%s' "$cmd" | grep -Eq "$NPM_WRITES_LOCK" || exit 0

if ! out=$(cd "$root" && node "$fixer" 2>&1); then
  # 보정 실패는 조용히 넘기지 않는다 — 대개 registry 버전이 올라가 스크립트의
  # 상수가 낡았다는 신호이고, 방치하면 CI 에서 터진다.
  printf '{"systemMessage":"⚠️ package-lock.json 보정 실패 — CI 가 실패할 수 있습니다. scripts/sync-lock-wasm-deps.mjs 를 확인하세요.","hookSpecificOutput":{"hookEventName":"PostToolUse","additionalContext":"lock 보정 스크립트가 실패했다. 출력: '"$(printf '%s' "$out" | tr -d '"' | tr '\n' ' ')"'. npm ci 가 통과하는지 확인하고 스크립트의 버전 상수를 갱신할 것."}}\n'
  exit 0
fi

# 보정이 실제로 일어난 경우만 알린다 (스크립트가 "보정 완료" 를 찍는다)
case "$out" in
  *'보정 완료'*)
    printf '{"systemMessage":"package-lock.json 을 보정했습니다 (%s) — 커밋에 포함하세요.","hookSpecificOutput":{"hookEventName":"PostToolUse","additionalContext":"npm 명령이 package-lock.json 에서 @emnapi 항목을 지웠고 훅이 되살렸습니다. 변경된 package-lock.json 을 반드시 커밋에 포함하세요 — 빠지면 Linux CI 의 npm ci 가 실패합니다."}}\n' "$out"
    ;;
esac

exit 0
