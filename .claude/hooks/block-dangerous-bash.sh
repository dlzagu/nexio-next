#!/bin/sh
# PreToolUse(Bash) — 위험 명령 차단.
#
# 계약: stdin 으로 훅 페이로드(JSON)를 받는다. exit 2 = 차단이고, 그때 stderr 가
#       Claude 에게 에러 메시지로 전달된다. exit 0 = 판단 보류(정상 권한 흐름).
#
# jq 를 쓰지 않고 stdin 원문을 그대로 훑는다. 이유: jq 는 Windows/최소 컨테이너에
# 없을 수 있는데, 파서가 없다고 검사를 건너뛰면 그게 곧 fail-open 이다. 원문 스캔은
# 과탐(넓게 걸림) 방향으로만 틀리므로 차단기로서는 안전한 쪽이다. 오탐이 잦은
# 패턴이 있으면 그 줄만 좁혀라 — 통째로 끄지 말 것.

payload=$(cat)

block() {
  printf '차단됨: %s — 위험 명령입니다.\n꼭 필요하면 사용자가 직접 실행하세요.\n' "$1" >&2
  exit 2
}

case "$payload" in
  *'rm -rf'*)           block 'rm -rf' ;;
  *'rm -fr'*)           block 'rm -fr' ;;
  *'git push --force'*) block 'git push --force' ;;
  *'git push -f'*)      block 'git push -f' ;;
  *'git reset --hard'*) block 'git reset --hard' ;;
  *'git clean -'*)      block 'git clean' ;;
  *'DROP TABLE'*)       block 'DROP TABLE' ;;
  *'DROP DATABASE'*)    block 'DROP DATABASE' ;;
  *'TRUNCATE TABLE'*)   block 'TRUNCATE TABLE' ;;
  *'mkfs'*)             block 'mkfs' ;;
  *'> /dev/sd'*)        block '블록 디바이스 직접 쓰기' ;;
esac

exit 0
