/**
 * 데모 DB 스키마. 원본 시스템에서 **화면이 실제로 읽는 컬럼만** 옮겼다 —
 * 테이블·컬럼명을 원본 그대로 유지해 `src/lib/data/` 의 쿼리 구조가 보존된다.
 * (원본 NX_OPTREPORTD 는 97컬럼이지만 MVP 3화면이 읽는 것은 이 부분집합이다)
 *
 * 날짜는 TEXT('YYYY-MM-DD HH:MM:SS') — SQLite date 함수·문자열 비교 모두 동작한다.
 */
/**
 * 스키마가 바뀔 때마다 올린다. **시드 구성이 바뀔 때도** 올린다 —
 * 예: 페르소나로 쓰는 계정이 늘면 옛 DB 에는 그 계정이 없어 역할 전환이 조용히 실패한다. 로컬 `.data/nexio.db` 는 파일로 남아 있어서,
 * 컬럼을 추가해도 이전 DB 가 그대로 열려 "없는 컬럼" 오류가 난다 →
 * 버전이 다르면 ensureSeed 가 통째로 다시 만든다 (데모 DB 라 잃을 게 없다).
 */
export const SCHEMA_VERSION = 8;

export const SCHEMA_SQL = `
CREATE TABLE NX_SCHEMA (VERSION INTEGER NOT NULL);

/*
 * 데모 시계 (ADR-0012) — 원본에 없는 표다. 행은 하나.
 * 가상 시드는 '만든 날'을 오늘로 보고 날짜를 찍는다. 그대로 두면 달력만 흘러 한 달 뒤엔
 * '최근 15일'·'최근 30일' 화면이 전부 비고 모든 건이 D+30 이 된다(라이브 실측).
 * ANCHOR = 이 세계가 맞춰져 있는 마지막 순간. 하루 이상 지나면 그때까지의 기록을 통째로 민다.
 * 컬럼을 NX_SCHEMA 에 붙이지 않은 이유: 공유 DB 는 컬럼 추가를 못 따라가지만 새 표는
 * db:sync:remote 가 만들어 준다.
 */
CREATE TABLE NX_DEMO_CLOCK (ANCHOR TEXT NOT NULL);

CREATE TABLE COMPANY_MST (
  COMPANY_CODE     TEXT PRIMARY KEY,
  COMPANY_NAME_LOC TEXT,
  ACTIVE           TEXT DEFAULT 'Y',
  SHOWYN           TEXT DEFAULT 'N',
  CONFYN           TEXT DEFAULT 'N',
  TESTYN           TEXT DEFAULT 'N',
  SYSTEMYN         TEXT DEFAULT 'N',
  DEF_PRIVATE_YN   TEXT DEFAULT 'N'
);

CREATE TABLE COMPANY_OPER_SYSTEM (
  OPER_SYS_ID  INTEGER PRIMARY KEY,
  COMPANY_CODE TEXT,
  SYSTEM_NAME  TEXT,
  USE_YN       TEXT DEFAULT 'Y',
  DEL_YN       TEXT DEFAULT 'N',
  SORT_ORD     INTEGER DEFAULT 0
);

CREATE TABLE MEMBER_MST (
  MBER_ID      TEXT PRIMARY KEY,
  MBER_NM      TEXT,
  USER_TYPE    TEXT,
  COMPANY_CODE TEXT,
  DEPT         TEXT,
  EMAIL        TEXT,
  APPROVER     TEXT DEFAULT 'N',
  ACTIVE       TEXT DEFAULT 'Y'
);

CREATE TABLE NX_OPTREPORTD (
  ECHONUM    TEXT PRIMARY KEY,
  CUSTCODE   TEXT,
  TITLE      TEXT,
  CONTENT    TEXT,
  REMARKS    TEXT,
  REQREMARKS TEXT,
  PROGRESS   TEXT,
  B1GUBUN    INTEGER,
  MODULE     TEXT,
  REQLEVEL   TEXT,
  REQTYPE    TEXT,
  CUSTPERSON TEXT,
  SUCCERSON  TEXT,
  REQDATE    TEXT,
  SCHEDATE   TEXT,
  SUCCDATE   TEXT,
  PUBLICYN   TEXT,
  WORKTIME   REAL,
  MEDIA      TEXT,
  REFMAIL    TEXT,
  REREQYN    TEXT DEFAULT 'N',
  P_ECHONUM  TEXT,
  CAUSE      TEXT,
  PROCESS    TEXT,
  IMPROVEMENT TEXT,
  ANSWER     TEXT,
  RESULT     TEXT,
  DEVREASON  TEXT,
  DEVCONTENT TEXT,
  OKREMARKS  TEXT,
  EXPETIME   REAL,
  RWORKTIME  REAL,
  SURTIME    REAL,
  APPROVER   TEXT,
  CONFIRMDT  TEXT,
  CANCELER   TEXT,
  CANCELDT   TEXT,
  CANCELREQDT TEXT,
  CANCELREQER TEXT,
  TESTDT     TEXT,
  TESTCOMDT  TEXT,
  SYSTEMDT   TEXT,
  FINALSUCCER TEXT,
  FINALSUCCDATE TEXT,
  CMEMO      TEXT,
  AMEMO      TEXT,
  TMEMO      TEXT,
  SMEMO      TEXT
);
CREATE INDEX idx_d_cust     ON NX_OPTREPORTD (CUSTCODE, PROGRESS);
CREATE INDEX idx_d_progress ON NX_OPTREPORTD (PROGRESS);
CREATE INDEX idx_d_reqdate  ON NX_OPTREPORTD (REQDATE);
CREATE INDEX idx_d_succ     ON NX_OPTREPORTD (SUCCERSON);

CREATE TABLE NX_OPTREPORTR (
  ID            INTEGER PRIMARY KEY AUTOINCREMENT,
  PECHONUM      TEXT,
  USERID        TEXT,
  COMMENT       TEXT,
  COMMDATE      TEXT,
  ADMIN_ONLY_YN TEXT DEFAULT 'N',
  IS_LOG_YN     TEXT DEFAULT 'N',
  PPROGRESS     TEXT
);
CREATE INDEX idx_r_p ON NX_OPTREPORTR (PECHONUM);

CREATE TABLE NX_OPTREPORT_READ_STATE (
  ECHONUM              TEXT,
  USER_ID              TEXT,
  LAST_SEEN_COMMENT_ID INTEGER,
  PRIMARY KEY (ECHONUM, USER_ID)
);

CREATE TABLE NX_OPTREPORT_FILE (
  ID        INTEGER PRIMARY KEY AUTOINCREMENT,
  PECHONUM  TEXT,
  FILE_NM   TEXT,
  MIME_TP   TEXT,
  FILE_SZ   INTEGER,
  FILE_DATA BLOB,
  USERID    TEXT,
  REG_DT    TEXT
);
CREATE INDEX idx_f_p ON NX_OPTREPORT_FILE (PECHONUM);

/*
 * 정기 업무 템플릿 — 원본에 없는 표다.
 * "매달 첫 주 백업 확인"처럼 **고객사가 신청하지 않는 반복 업무**를 담아 두고,
 * 버튼 한 번에 이번 달 티켓을 만든다. 서버리스라 스케줄러가 없어 사람이 방아쇠를 당기지만,
 * LAST_RUN_YM 이 이번 달이면 다시 만들지 않으므로 여러 번 눌러도 한 건이다.
 */
CREATE TABLE NX_TASK_TEMPLATE (
  ID           INTEGER PRIMARY KEY AUTOINCREMENT,
  CUSTCODE     TEXT NOT NULL,
  TITLE        TEXT NOT NULL,
  CONTENT      TEXT,
  B1GUBUN      INTEGER,
  MODULE       TEXT,
  REQLEVEL     TEXT DEFAULT '3',
  MEDIA        TEXT,
  OWNER        TEXT,
  DAY_OF_MONTH INTEGER DEFAULT 1,
  ACTIVE       TEXT DEFAULT 'Y',
  /** 마지막으로 티켓을 만든 달 'YYYY-MM' — 같은 달 중복 생성을 막는 유일한 장치다 */
  LAST_RUN_YM  TEXT,
  REG_DT       TEXT
);
CREATE INDEX idx_tt_cust ON NX_TASK_TEMPLATE (CUSTCODE, ACTIVE);

CREATE TABLE BOARD_DETAIL (
  NTT_ID    INTEGER PRIMARY KEY,
  NTT_SJ    TEXT,
  NTT_CN    TEXT,
  NTCR_NM   TEXT,
  REG_DT    TEXT,
  DELETE_FG TEXT DEFAULT 'N',
  USE_FG    TEXT DEFAULT 'Y'
);
`;
