import { beforeAll, describe, expect, it } from "vitest";
import type { TicketFilters, User } from "@/lib/types";

/**
 * 첨부 경로 — 실제 SQLite 에 BLOB 을 넣고 다시 꺼낸다.
 *
 * 검증 축:
 *  1. 한도·형식이 **서버에서** 막히는가 (클라이언트가 보낸 크기·형식은 믿지 않는다)
 *  2. 신청/댓글과 **한 트랜잭션**인가 (한쪽만 남지 않는다)
 *  3. 다운로드가 가시성 게이트를 지나는가 (id 를 알아도 남의 건은 못 받는다)
 */
process.env.SQLITE_PATH = ":memory:";
process.env.ALLOW_DEV_WRITES = "true";

import {
  AttachmentError,
  attachmentStatements,
  decodeUploads,
  getAttachment,
  listAttachments,
  validateUploads,
  type IncomingFile,
} from "@/lib/data/attachments";
import { addComment, createTicket } from "@/lib/data/mutations";
import { listTickets } from "@/lib/data/tickets";
import { select } from "@/lib/db";
import { MAX_FILE_BYTES, safeFileName } from "@/lib/attachments";

const internal: User = {
  id: "sy.kim",
  name: "김서연",
  role: "INTERNAL",
  custCode: "NX000",
  custName: "(주)넥시오솔루션",
  dept: "서비스운영팀",
  email: "sy.kim@nexio-ops.example",
  isApprover: false,
};

const filters = (over: Partial<TicketFilters> = {}): TicketFilters => ({
  view: "all",
  keyword: "",
  custCode: "",
  progress: "",
  from: "",
  to: "",
  assignee: "",
  requester: "",
  module: "",
  priority: "",
  includeMigration: false,
  ...over,
});

const file = (name: string, mime: string, body = "hello"): IncomingFile => ({
  name,
  mime,
  bytes: Buffer.from(body, "utf8"),
});

beforeAll(async () => {
  await select("SELECT 1 AS ok");
});

describe("업로드 검증 — 서버가 다시 잰다", () => {
  it("허용 목록 밖의 형식은 거부한다 (fail-closed)", () => {
    expect(() =>
      validateUploads([file("a.exe", "application/x-msdownload")]),
    ).toThrow(AttachmentError);
    // 실행되는 마크업은 일부러 뺐다
    expect(() => validateUploads([file("logo.svg", "image/svg+xml")])).toThrow(
      AttachmentError,
    );
    expect(() => validateUploads([file("a.html", "text/html")])).toThrow(
      AttachmentError,
    );
  });

  it("확장자와 형식이 어긋나면 거부한다 (이름만 바꿔 통과시킬 수 없다)", () => {
    expect(() => validateUploads([file("payload.exe", "image/png")])).toThrow(
      AttachmentError,
    );
    expect(() =>
      validateUploads([file("shot.png", "image/png")]),
    ).not.toThrow();
  });

  it("개수·크기 한도는 선언값이 아니라 **실제 바이트**로 판정한다", () => {
    const many = Array.from({ length: 6 }, (_, i) =>
      file(`f${i}.txt`, "text/plain"),
    );
    expect(() => validateUploads(many)).toThrow(/최대/);

    const big: IncomingFile = {
      name: "big.txt",
      mime: "text/plain",
      bytes: Buffer.alloc(MAX_FILE_BYTES + 1, 0x41),
    };
    expect(() => validateUploads([big])).toThrow(AttachmentError);

    // 합계 한도 — 개당은 통과하지만 모이면 넘는다
    const chunk = () => ({
      name: `${Math.random()}.txt`,
      mime: "text/plain",
      bytes: Buffer.alloc(MAX_FILE_BYTES, 0x41),
    });
    expect(() => validateUploads([chunk(), chunk(), chunk()])).toThrow(/합계/);
  });

  it("파일명의 경로·제어문자를 걷어낸다 (헤더에 그대로 실린다)", () => {
    expect(safeFileName("../../etc/passwd.txt")).toBe("passwd.txt");
    expect(safeFileName("C:\\temp\\보고서.csv")).toBe("보고서.csv");
    expect(validateUploads([file("../a.txt", "text/plain")])[0].name).toBe(
      "a.txt",
    );
  });

  it("빈 파일·깨진 base64 는 거부한다", () => {
    expect(() =>
      decodeUploads([{ name: "a.txt", mime: "text/plain", data: "" }]),
    ).toThrow(AttachmentError);
    // 데이터 URI 접두가 붙어 와도 벗겨 낸다
    const [d] = decodeUploads([
      {
        name: "a.txt",
        mime: "text/plain",
        data: "data:text/plain;base64,aGVsbG8=",
      },
    ]);
    expect(d.bytes.toString("utf8")).toBe("hello");
  });
});

describe("저장 — 본문과 한 트랜잭션", () => {
  it("신청과 첨부가 함께 들어간다", async () => {
    const created = await createTicket(
      {
        custCode: "HB001",
        requesterId: "hb.yoon",
        systemId: "1",
        title: "첨부 포함 신청",
        symptom: "증상",
        content: "내용",
        moduleCode: "",
        priority: "3",
        scheDate: "",
        isPublic: true,
        refEmails: [],
        parentEchoNum: null,
        usesApproval: false,
        files: [file("재현절차.txt", "text/plain", "1. 열기\n2. 저장")],
      },
      internal,
    );

    const list = await listAttachments(created.echoNum, internal);
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe("재현절차.txt");
    expect(list[0].size).toBe(Buffer.from("1. 열기\n2. 저장", "utf8").length);

    const blob = await getAttachment(created.echoNum, list[0].id, internal);
    expect(blob?.bytes.toString("utf8")).toContain("2. 저장");
  });

  it("첨부가 거부되면 신청 자체가 저장되지 않는다 (한쪽만 남지 않는다)", async () => {
    const before = (await listTickets(filters({ custCode: "HB001" }), internal))
      .total;
    await expect(
      createTicket(
        {
          custCode: "HB001",
          requesterId: "hb.yoon",
          systemId: "1",
          title: "거부될 신청",
          symptom: "증상",
          content: "내용",
          moduleCode: "",
          priority: "3",
          scheDate: "",
          isPublic: true,
          refEmails: [],
          parentEchoNum: null,
          usesApproval: false,
          files: [file("bad.exe", "application/x-msdownload")],
        },
        internal,
      ),
    ).rejects.toBeInstanceOf(AttachmentError);

    const after = (await listTickets(filters({ custCode: "HB001" }), internal))
      .total;
    expect(after).toBe(before);
  });

  it("댓글에 붙인 첨부도 같은 목록에 쌓인다", async () => {
    const { rows } = await listTickets(filters({ view: "open" }), internal);
    const row = rows[0];
    const before = await listAttachments(row.echoNum, internal);

    await addComment({
      echoNum: row.echoNum,
      user: internal,
      body: "<p>로그 첨부합니다.</p>",
      adminOnly: false,
      files: [file("오류.log", "text/plain", "ERROR 발생")],
    });

    const after = await listAttachments(row.echoNum, internal);
    expect(after).toHaveLength(before.length + 1);
    expect(after.at(-1)?.name).toBe("오류.log");
    expect(after.at(-1)?.uploaderId).toBe(internal.id);
  });
});

describe("다운로드 — 가시성 게이트를 지난다", () => {
  it("id 를 알아도 못 보는 티켓의 첨부는 받을 수 없다", async () => {
    // 첨부가 달린 티켓을 하나 찾는다 (시드가 일부에 붙여 둔다)
    const withFile = await select<{
      PECHONUM: string;
      ID: number;
      CUSTCODE: string;
    }>(
      `SELECT f.ID, f.PECHONUM, d.CUSTCODE
         FROM NX_OPTREPORT_FILE f
         JOIN NX_OPTREPORTD d ON d.ECHONUM = f.PECHONUM
        WHERE d.CUSTCODE <> 'HB001' LIMIT 1`,
    );
    const target = withFile[0];
    expect(target).toBeDefined();

    // 운영팀은 받는다
    expect(
      (await getAttachment(target.PECHONUM, target.ID, internal))?.bytes.length,
    ).toBeGreaterThan(0);

    // 다른 고객사 사용자는 못 받는다 (존재 여부도 흘리지 않는다 → null)
    const outsider: User = {
      ...internal,
      id: "hb.yoon",
      role: "CUSTOMER",
      custCode: "HB001",
      isApprover: true,
    };
    expect(
      await getAttachment(target.PECHONUM, target.ID, outsider),
    ).toBeNull();
    expect(await listAttachments(target.PECHONUM, outsider)).toHaveLength(0);
  });

  it("접수번호와 파일 id 가 **함께** 맞아야 한다", async () => {
    const rows = await select<{ ID: number; PECHONUM: string }>(
      // 🔴 서로 **다른 티켓**의 파일이어야 한다 — 한 티켓에 2개 붙은 경우를 뽑으면
      //    "다른 접수번호"가 아니라 같은 접수번호라 검사가 통과해 버린다
      `SELECT MIN(ID) AS ID, PECHONUM FROM NX_OPTREPORT_FILE GROUP BY PECHONUM LIMIT 2`,
    );
    expect(rows).toHaveLength(2);
    // 다른 티켓의 접수번호로는 못 꺼낸다
    expect(
      await getAttachment(rows[1].PECHONUM, rows[0].ID, internal),
    ).toBeNull();
    // 이상한 id 는 조회 자체를 하지 않는다
    expect(await getAttachment(rows[0].PECHONUM, 0, internal)).toBeNull();
    expect(await getAttachment(rows[0].PECHONUM, NaN, internal)).toBeNull();
  });
});

describe("시드", () => {
  it("배포본에서도 첨부 화면이 비어 있지 않다 (쓰기가 꺼져 있으므로)", async () => {
    const n = await select<{ n: number }>(
      `SELECT COUNT(*) AS n FROM NX_OPTREPORT_FILE`,
    );
    expect(Number(n[0].n)).toBeGreaterThan(50);
  });

  it("첨부 INSERT 문은 write() 관문을 통과하는 형태다", () => {
    const [stmt] = attachmentStatements({
      echoNum: "HB-202608-001",
      user: internal,
      files: [file("a.txt", "text/plain")],
      at: "2026-08-18 10:00:00",
    });
    expect(stmt.sql.trim().toUpperCase().startsWith("INSERT")).toBe(true);
    expect(stmt.params?.find((p) => p.name === "data")?.value).toBeInstanceOf(
      Buffer,
    );
  });
});
