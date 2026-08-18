import { NextResponse } from "next/server";
import { getAttachment } from "@/lib/data/attachments";
import { currentUser } from "@/lib/session";

/**
 * 첨부 다운로드.
 *
 * 🔒 파일 id 만으로는 받을 수 없다 — 접수번호와 **함께** 맞아야 하고, 그 티켓이
 *    내 가시성 안에 있어야 한다(getAttachment 안의 scopeClause). 밖이면 404 로,
 *    존재 여부조차 흘리지 않는다.
 *
 * ⚠️ 언제나 `attachment` 로 내려보낸다(+ nosniff). 브라우저가 열어 실행할 수 있는
 *    형식은 업로드에서 이미 막지만(SVG·HTML 제외), 통로 쪽에서도 한 겹 더 잠근다.
 */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ echoNum: string; id: string }> },
) {
  const { echoNum, id } = await ctx.params;
  const user = await currentUser();
  if (!user) return NextResponse.json({ code: "NO_SESSION" }, { status: 401 });

  const file = await getAttachment(
    decodeURIComponent(echoNum),
    Number(id),
    user,
  );
  if (!file) return NextResponse.json({ code: "NOT_FOUND" }, { status: 404 });

  // 헤더에는 ASCII 만 실린다 — 한글 파일명은 filename* 쪽에서 전달한다
  const ascii = [...file.name]
    .map((ch) => {
      const code = ch.charCodeAt(0);
      return code > 31 && code < 127 && ch !== '"' ? ch : "_";
    })
    .join("");

  return new Response(new Uint8Array(file.bytes), {
    headers: {
      "content-type": file.mime,
      "content-length": String(file.bytes.length),
      "content-disposition": `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(file.name)}`,
      "x-content-type-options": "nosniff",
      "cache-control": "private, no-store",
    },
  });
}
