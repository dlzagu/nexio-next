#!/bin/sh
# PostToolUse(Write|Edit) — 방금 편집된 파일 "1개만" 포맷한다.
#
# 왜 파일 1개인가: 훅에 프로젝트 루트를 통째로 넘기면(prettier --write "$CLAUDE_PROJECT_DIR")
#   ① 매 편집마다 전체 트리를 훑어 느려지고 — 훅이 도는 동안 Claude 는 멈춘다
#   ② 이번에 건드리지도 않은 파일까지 리포맷돼 diff 가 오염된다(리뷰 불가)
# PostToolUse 페이로드에 tool_input.file_path 가 오므로 그 파일만 포맷하면 된다.
#
# .prettierignore 는 prettier 가 알아서 존중한다 → docs/ 산출물은 건드리지 않는다.

payload=$(cat)

if command -v jq >/dev/null 2>&1; then
  file=$(printf '%s' "$payload" | jq -r '.tool_input.file_path // empty')
else
  # jq 부재 시 폴백. JSON 이스케이프(\\)만 되돌린다 — 경로에 따옴표가 들어가면
  # 실패하지만, 그때는 포맷을 건너뛸 뿐이라 안전하다.
  file=$(printf '%s' "$payload" \
    | sed -n 's/.*"file_path"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' \
    | head -n 1 | sed 's/\\\\/\\/g')
fi

[ -n "$file" ] || exit 0
[ -f "$file" ] || exit 0

# --no-install: 프로젝트 로컬 prettier 만 쓴다 (없으면 조용히 넘어감 — 전역 설치 유발 금지)
case "$file" in
  *.ts|*.tsx|*.js|*.jsx|*.mjs|*.json|*.css|*.md)
    npx --no-install prettier --write "$file" >/dev/null 2>&1 ;;
esac

exit 0
