import {
  MAX_FILES,
  MAX_FILE_BYTES,
  MAX_TOTAL_BYTES,
  fmtBytes,
  isAllowedType,
  safeFileName,
} from "../attachments";
import { select, type Param, type WriteStatement } from "../db";
import { toWallClockIso } from "../format";
import type { AttachmentMeta, User } from "../types";
import { scopeClause } from "./tickets";

/**
 * 첨부파일 저장·조회. 바이트는 데모 DB 의 BLOB 에 들어간다 (`NX_OPTREPORT_FILE`).
 *
 * 🔴 쓰기는 **호출자가 만든 트랜잭션에 얹는다** — 문장 배열을 돌려줄 뿐 직접 write() 하지
 *    않는다. 신청 INSERT 와 첨부 INSERT 가 따로 커밋되면 "첨부가 사라진 신청"이 남는다
 *    (상태 변경과 이력 로그를 한 트랜잭션에 넣는 이유와 같다 — ADR-0006 §1).
 *
 * 🔒 읽기는 티켓 가시성 게이트(scopeClause)를 그대로 지난다. 파일 id 를 알아도
 *    그 티켓을 볼 수 없으면 못 받는다.
 */

export type { AttachmentMeta };

export interface AttachmentBlob extends AttachmentMeta {
  bytes: Buffer;
}

/** 업로드로 들어온 파일 하나 (base64 는 이미 디코드된 상태) */
export interface IncomingFile {
  name: string;
  mime: string;
  bytes: Buffer;
}

export class AttachmentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AttachmentError";
  }
}

/**
 * 서버측 최종 검증. 클라이언트가 보낸 크기·형식을 믿지 않는다 —
 * **디코드한 실제 바이트 길이**로 다시 잰다 (선언값은 참고도 하지 않는다).
 */
export function validateUploads(files: IncomingFile[]): IncomingFile[] {
  if (files.length === 0) return [];
  if (files.length > MAX_FILES) {
    throw new AttachmentError(
      `첨부는 최대 ${MAX_FILES}개까지 올릴 수 있습니다 (${files.length}개).`,
    );
  }

  let total = 0;
  return files.map((f) => {
    const name = safeFileName(f.name);
    if (!isAllowedType(name, f.mime)) {
      throw new AttachmentError(`${name} — 지원하지 않는 형식입니다.`);
    }
    if (f.bytes.length === 0) {
      throw new AttachmentError(`${name} — 빈 파일입니다.`);
    }
    if (f.bytes.length > MAX_FILE_BYTES) {
      throw new AttachmentError(
        `${name} — 파일 하나는 ${fmtBytes(MAX_FILE_BYTES)}까지 첨부할 수 있습니다.`,
      );
    }
    total += f.bytes.length;
    if (total > MAX_TOTAL_BYTES) {
      throw new AttachmentError(
        `첨부 합계가 ${fmtBytes(MAX_TOTAL_BYTES)}를 넘습니다.`,
      );
    }
    return { name, mime: f.mime.toLowerCase(), bytes: f.bytes };
  });
}

/**
 * base64 → 바이트. 데이터 URI 접두(`data:image/png;base64,`)가 붙어 와도 벗겨 낸다.
 * 여기서는 형태만 풀고, 크기·형식 판정은 validateUploads 한 곳에서 한다.
 */
export function decodeUploads(
  input: { name: string; mime: string; data: string }[],
): IncomingFile[] {
  return input.map((f) => {
    const raw = f.data.replace(/^data:[^,]*,/, "");
    const bytes = Buffer.from(raw, "base64");
    if (bytes.length === 0) {
      throw new AttachmentError(
        `${safeFileName(f.name)} — 파일을 읽지 못했습니다.`,
      );
    }
    return { name: f.name, mime: f.mime, bytes };
  });
}

/** 티켓에 붙일 INSERT 문들. 호출자의 write() 트랜잭션에 그대로 얹는다 */
export function attachmentStatements(opts: {
  echoNum: string;
  user: User;
  files: IncomingFile[];
  at: string;
}): WriteStatement[] {
  return validateUploads(opts.files).map((f) => ({
    sql: `INSERT INTO NX_OPTREPORT_FILE
            (PECHONUM, FILE_NM, MIME_TP, FILE_SZ, FILE_DATA, USERID, REG_DT)
          VALUES (@echo, @name, @mime, @size, @data, @uid, @at)`,
    params: [
      { name: "echo", value: opts.echoNum },
      { name: "name", value: f.name },
      { name: "mime", value: f.mime },
      { name: "size", value: f.bytes.length },
      { name: "data", value: f.bytes },
      { name: "uid", value: opts.user.id },
      { name: "at", value: opts.at },
    ],
  }));
}

interface RawFile {
  ID: number;
  FILE_NM: string | null;
  MIME_TP: string | null;
  FILE_SZ: number | null;
  USERID: string | null;
  uploaderName: string | null;
  REG_DT: string | null;
}

const toMeta = (r: RawFile): AttachmentMeta => ({
  id: Number(r.ID),
  name: (r.FILE_NM ?? "").trim() || "첨부파일",
  mime: (r.MIME_TP ?? "").trim() || "application/octet-stream",
  size: Number(r.FILE_SZ ?? 0),
  uploaderId: (r.USERID ?? "").trim(),
  uploaderName: (r.uploaderName ?? "").trim() || null,
  at: toWallClockIso(r.REG_DT),
});

/** 그 요청의 첨부 목록 (바이트는 싣지 않는다 — 목록에 BLOB 을 끌고 다니지 않는다) */
export async function listAttachments(
  echoNum: string,
  user: User,
): Promise<AttachmentMeta[]> {
  const params: Param[] = [];
  const scope = scopeClause(user, params);
  params.push({ name: "en", value: echoNum });

  const rows = await select<RawFile>(
    `SELECT f.ID, f.FILE_NM, f.MIME_TP, f.FILE_SZ, f.USERID, f.REG_DT,
            m.MBER_NM AS uploaderName
       FROM NX_OPTREPORT_FILE f
       JOIN NX_OPTREPORTD d ON d.ECHONUM = f.PECHONUM
       LEFT JOIN MEMBER_MST m ON m.MBER_ID = f.USERID
      WHERE f.PECHONUM = @en AND ${scope}
      ORDER BY f.ID`,
    params,
  );
  return rows.map(toMeta);
}

/**
 * 다운로드용 한 건. **가시성 게이트를 지나야** 바이트를 준다 —
 * id 를 추측해도 남의 회사 첨부는 받을 수 없다(fail-closed).
 */
export async function getAttachment(
  echoNum: string,
  id: number,
  user: User,
): Promise<AttachmentBlob | null> {
  if (!Number.isInteger(id) || id <= 0) return null;

  const params: Param[] = [];
  const scope = scopeClause(user, params);
  params.push({ name: "en", value: echoNum }, { name: "id", value: id });

  const rows = await select<RawFile & { FILE_DATA: Buffer | null }>(
    `SELECT f.ID, f.FILE_NM, f.MIME_TP, f.FILE_SZ, f.USERID, f.REG_DT, f.FILE_DATA,
            m.MBER_NM AS uploaderName
       FROM NX_OPTREPORT_FILE f
       JOIN NX_OPTREPORTD d ON d.ECHONUM = f.PECHONUM
       LEFT JOIN MEMBER_MST m ON m.MBER_ID = f.USERID
      WHERE f.ID = @id AND f.PECHONUM = @en AND ${scope}`,
    params,
  );
  const r = rows[0];
  if (!r || !r.FILE_DATA) return null;
  return { ...toMeta(r), bytes: Buffer.from(r.FILE_DATA) };
}
