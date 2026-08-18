/**
 * 첨부파일 규약 — 클라이언트·서버가 **같은 한도**를 본다.
 *
 * 저장 위치는 데모 DB 안(BLOB)이다. 외부 스토리지를 두면 "클론하면 바로 돈다"는
 * 이 프로젝트의 전제가 깨진다(ADR-0004). 대신 한도를 좁게 잡는다.
 *
 * 🔒 허용 목록 방식이다 — 모르는 형식은 거부(fail-closed).
 *    SVG·HTML 은 **일부러 뺐다**: 브라우저가 실행하는 마크업이라 저장형 XSS 통로가 된다.
 *    (다운로드는 항상 attachment 로 강제하지만, 통로를 둘 이유가 없다)
 */

export const MAX_FILES = 5;
export const MAX_FILE_BYTES = 2 * 1024 * 1024; // 2MB
export const MAX_TOTAL_BYTES = 5 * 1024 * 1024; // 5MB

/** MIME → 허용 확장자. 둘이 **함께** 맞아야 통과한다 */
export const ALLOWED_TYPES: Record<string, string[]> = {
  "image/png": [".png"],
  "image/jpeg": [".jpg", ".jpeg"],
  "image/gif": [".gif"],
  "image/webp": [".webp"],
  "application/pdf": [".pdf"],
  "text/plain": [".txt", ".log", ".md"],
  "text/csv": [".csv"],
  "application/zip": [".zip"],
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [
    ".xlsx",
  ],
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [
    ".docx",
  ],
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": [
    ".pptx",
  ],
};

/** 파일 선택 대화상자의 accept 값 */
export const ACCEPT_ATTR = Object.values(ALLOWED_TYPES).flat().join(",");

export function extensionOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i < 0 ? "" : name.slice(i).toLowerCase();
}

/**
 * 파일명 정리. 경로 구분자·따옴표·제어문자를 걷어낸다 —
 * 저장하는 건 이름뿐이지만, 그 이름이 그대로 다운로드 헤더에 실린다.
 */
export function safeFileName(raw: string): string {
  const base = raw.split(/[\\/]/).pop() ?? "";
  const cleaned = [...base]
    .filter((ch) => {
      const code = ch.charCodeAt(0);
      return code > 31 && code !== 127 && ch !== '"';
    })
    .join("")
    .trim();
  return cleaned.slice(0, 120) || "첨부파일";
}

/**
 * 브라우저가 형식을 모르는 파일(.log·.md 등)은 `File.type` 이 빈 문자열이다 —
 * 그대로 보내면 "지원하지 않는 형식"으로 반려된다. 확장자에서 되찾는다.
 */
export function resolveMime(name: string, declared: string): string {
  if (declared) return declared.toLowerCase();
  const ext = extensionOf(name);
  const hit = Object.entries(ALLOWED_TYPES).find(([, exts]) =>
    exts.includes(ext),
  );
  return hit?.[0] ?? "";
}

/** 형식이 허용 목록에 있고, 확장자가 그 형식과 맞는가 */
export function isAllowedType(name: string, mime: string): boolean {
  const exts = ALLOWED_TYPES[mime.toLowerCase()];
  return !!exts && exts.includes(extensionOf(name));
}

export function fmtBytes(n: number): string {
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)}KB`;
  return `${(n / (1024 * 1024)).toFixed(1)}MB`;
}

/** 업로드 거부 사유 — 화면과 서버가 같은 문장을 쓴다 */
export function rejectReason(
  file: { name: string; type: string; size: number },
  totalBytes: number,
): string | null {
  if (!isAllowedType(file.name, resolveMime(file.name, file.type))) {
    return `${file.name} — 지원하지 않는 형식입니다 (이미지·PDF·문서·zip·텍스트만 첨부할 수 있습니다)`;
  }
  if (file.size > MAX_FILE_BYTES) {
    return `${file.name} — 파일 하나는 ${fmtBytes(MAX_FILE_BYTES)}까지 첨부할 수 있습니다`;
  }
  if (totalBytes + file.size > MAX_TOTAL_BYTES) {
    return `${file.name} — 첨부 합계가 ${fmtBytes(MAX_TOTAL_BYTES)}를 넘습니다`;
  }
  return null;
}
