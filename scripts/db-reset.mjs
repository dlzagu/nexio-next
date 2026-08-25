/**
 * 데모 DB 삭제 — 다음 실행 때 다시 시드된다.
 *
 * 왜 한 줄짜리(`fs.rmSync('.data', {force:true})`)를 스크립트로 옮겼나:
 * **개발 서버가 DB 파일을 물고 있으면 그 한 줄이 Node 를 통째로 죽였다**(Windows 파일 잠금,
 * 종료코드 0xC0000409). 출력도 없어서 지운 줄 알고 다음 작업을 하게 된다 —
 * 실제로 그 상태로 README 스크린샷을 찍어 시드에 없는 테스트 데이터가 찍혔다.
 *
 * 그래서 ① 파일을 **하나씩** 지우고(잠겨 있으면 EBUSY 예외로 얌전히 잡힌다)
 *        ② 끝나고 **정말 지워졌는지 확인**하고 ③ 실패하면 이유와 함께 크게 말한다.
 */
import { existsSync, readdirSync, rmdirSync, unlinkSync } from "node:fs";
import path from "node:path";

const DIR = path.join(process.cwd(), ".data");

if (!existsSync(DIR)) {
  console.log("데모 DB 가 이미 없습니다 — 다음 실행 때 새로 만들어집니다.");
  process.exit(0);
}

const locked = [];
for (const name of readdirSync(DIR)) {
  try {
    unlinkSync(path.join(DIR, name));
  } catch (e) {
    locked.push(`${name} (${e.code ?? "ERR"})`);
  }
}

if (locked.length === 0) {
  try {
    rmdirSync(DIR);
  } catch {
    // 폴더가 남는 것은 문제가 아니다 — 비어 있으면 다음 실행이 다시 채운다
  }
}

if (locked.length > 0) {
  console.error(
    `⛔ 데모 DB 를 지우지 못했습니다: ${locked.join(", ")}\n` +
      "   개발 서버가 파일을 물고 있는 경우가 대부분입니다 — 서버를 멈추고 다시 실행하세요.",
  );
  process.exit(1);
}

console.log("데모 DB 를 지웠습니다 — 다음 실행 때 새로 시드됩니다.");
