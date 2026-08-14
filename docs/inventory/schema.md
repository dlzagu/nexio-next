# VO 스키마 — 폼/타입의 원본

> 원본: `com.example.portal.svc.model.*` (Lombok `@Data`, 전부 평범한 POJO)
> 이 문서가 TS 타입 생성의 기준이 된다. 조사일: 2026-07-30

## 요약

| VO                     | 필드 수 | 쓰는 곳                                      |
| ---------------------- | ------- | -------------------------------------------- |
| **`EcoLineRequestVO`** | **102** | 조회 상세 · 신청 저장 — **중심 도메인 객체** |
| `EcoLineProcessVO`     | 33      | 조회 화면의 처리(엔지니어측)                 |
| `EcoLineSearchVO`      | 13      | 조회 목록 검색 조건                          |
| `EcoLineUpdateVO`      | 9       | 신청자측 수정/취소                           |
| `EcoLineProjectsVO`    | 9       | 프로젝트·계약기간                            |
| `EcoLineReqFormInitVO` | 6       | 신청 폼 초기 코드 목록                       |
| `EcoLineAddInfoVO`     | 6       | 고객사별 기능 노출 플래그                    |
| `EcoLineMberInfoVO`    | 3       | 고객 담당자 자동채움                         |

---

## 1. 핵심 발견 — 102필드가 워크플로 단계별로 뭉쳐 있다

`EcoLineRequestVO` 는 **티켓 하나의 전 생애주기**(신청 → 승인 → 처리 → 테스트이관 → 시스템이관 → 완료)를
단일 객체에 담았다. 현재 화면은 이 102개를 **한 페이지에 세로로 전부** 펼쳐 놓은 것이다.
그래서 6,611줄 · input 69개 · modal 0개가 나왔다.

**뒤집어 보면 이게 곧 재설계 청사진이다.** 필드가 이미 단계별로 갈라져 있으므로,
그 경계를 그대로 화면 경계로 쓰면 된다.

| #   | 그룹          | 필드 수 | 필드                                                                                                                            | 누가 언제 보는가           |
| --- | ------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| A   | 식별자        | 6       | `custCode` `year` `month` `lineSeq` `serviceNo` `echonum`                                                                       | 시스템 (숨김/헤더)         |
| B   | 분류·메타     | 10      | `b1Gubun` `b1SubGubun` `b1GubunCd` `module` `moduleCd` `rpaProcess` `rpaProcessName` `reqType` `media` `reqLevel`/`reqLevelCd`  | 신청 시 고객               |
| C   | 신청 내용     | 6       | `title` `remarks` `reqRemarks` `reqRemarksCd` `CONTENT` `publicYn`                                                              | 신청 시 고객               |
| D   | 신청자·담당자 | 9       | `custPerson` `custName` `custMber{Name,TelNo,Email,Posi}` `manager{Name,TelNo,Email}`                                           | 신청 시 (자동채움)         |
| E   | 참조자·알림   | 2       | `refEmail` `processCcEmails`                                                                                                    | 신청/처리 양쪽             |
| F   | 일정          | 7       | `reqDate` `reqDateTime` `createDt` `scheDate` `expeSuccDate` `succDate` `finalSuccDate`                                         | 전 단계                    |
| G   | 승인 워크플로 | 10      | `succPerson` `succPersonName` `finalSuccer` `approverYn` `approver` `isApprover` `confirmDt` `canceler` `cancelDt` `cApproveYn` | 승인자                     |
| H   | 처리 결과     | 11      | `cause` `process` `improvement` `answer` `result` `devReason` `devContent` `okRemarks` `progress` `progressName` `vProgress`    | **엔지니어 (고객이 읽음)** |
| I   | 테스트 이관   | 6       | `testYn` `testDt` `tester` `testComDt` `testComer` `lineTestYn`                                                                 | 이관 단계만                |
| J   | 시스템 이관   | 8       | `systemYn` `systemDt` `systemer` `systemComDt` `systemComer` `systemSelfYn` `systemBy` `lineSystemYn`                           | 이관 단계만                |
| K   | 시간·정산     | 5       | `expeTime` `workTime` `rWorkTime` `surTime` `surCharge`                                                                         | 엔지니어                   |
| L   | 프로젝트·계약 | 7       | `custPrjNm` `prjStartDt` `prjEndDt` `rMonth` `rStartDt` `rEndDt` `repairYn`                                                     | 참조용                     |
| M   | 단계별 메모   | 4       | `cMemo` `aMemo` `tMemo` `sMemo`                                                                                                 | 각 단계                    |
| N   | 첨부          | 3       | `atchmnflId` `solutionAtchmnflId` `attachFiles`                                                                                 | 신청/처리 양쪽             |
| O   | 재신청        | 2       | `reReqYn` `pEchoNum`                                                                                                            | 예외 흐름                  |
| P   | 댓글          | 2       | `newCommentYn` `lastSeenCommentId`                                                                                              | **고객 소통 핵심**         |
| Q   | 기타 플래그   | 4       | `confYn` `autoDetailYn` `testYn`(중복) `userId`                                                                                 | 시스템                     |

### UX 재설계에 그대로 쓸 결론

- **I·J(이관 14필드)는 해당 단계에서만 존재한다** → 평시엔 화면에 있을 이유가 없다. 지금은 항상 떠 있다.
- **H(처리 결과 11필드)가 고객이 실제로 읽는 부분**이다 → 조회 화면의 주인공은 이 블록이어야 한다.
- **P(댓글)가 "고객과 소통"의 실체**다 → 지금은 102필드 사이에 파묻혀 있다. 전면으로 끌어내야 한다.
- **A·Q는 사람이 볼 필드가 아니다** → 완전히 숨긴다.
- 신청 단계에서 고객이 채우는 건 실질적으로 **B+C+D+E = 27필드** 뿐이다.
  나머지 75필드는 처리 과정에서 시스템·엔지니어가 채운다.
  → **신청 폼은 27필드짜리로 설계 가능하다.** 현재 ST002 의 input 22개와 대체로 일치한다.

---

## 2. 액션 열거 — 버튼이 곧 상태 전이

두 VO 가 `action` 문자열로 버튼을 구분한다. **워크플로 상태머신의 실체**다.

```
EcoLineProcessVO.action  (엔지니어측)
  btnSave · btnAccept · btnTestReq · btnSystemReq

EcoLineUpdateVO.action   (신청자측)
  주석상 "버튼 클릭 action" — 실제 값 목록은 ST001.jsp 에서 추출 필요 (P1.s3)
```

> `progress` / `progressName` / `vProgress` 세 개가 공존한다 → 상태 표현이 3중이다.
> 재설계 시 **단일 상태 enum 으로 정규화**할 것. (P1.s3 에서 실제 값 수집)

---

## 3. 검색 조건 (`EcoLineSearchVO`, 13필드)

조회 화면 필터의 전부다. **입력 69개 중 필터는 11개뿐**이라는 뜻 —
나머지 58개는 상세 편집용 컨트롤이 목록 화면에 같이 얹혀 있다는 강력한 신호.

| 필드                        | 용도                       |
| --------------------------- | -------------------------- |
| `echoNum`                   | 요청번호                   |
| `custCode`                  | 고객사                     |
| `custPerson` / `succPerson` | 신청자 / 담당자            |
| `userId`                    | 로그인 사용자              |
| `fromDate` / `toDate`       | 신청일 범위 (`REQDATE`)    |
| `progress`                  | 진행상태                   |
| `b1Gubun`                   | 구분                       |
| `keyword`                   | `TITLE`/`REMARKS` 전문검색 |
| `myOnlyYn`                  | 내 것만                    |
| `page` / `size`             | 페이징 (기본 1 / 20)       |

---

## 4. 고객사별 기능 토글 (`EcoLineAddInfoVO`)

**화면이 고객사마다 다르게 보인다.** 재설계 시 조건부 렌더의 축.

| 필드       | 의미                      |
| ---------- | ------------------------- |
| `showYn`   | 계약시간 노출 여부        |
| `confYn`   | 신청승인 절차 사용 여부   |
| `approver` | 승인자 여부               |
| `testYn`   | 테스트이관 단계 사용 여부 |
| `systemYn` | 시스템이관 단계 사용 여부 |

> 즉 I·J(이관 14필드)는 **고객사에 따라 아예 없는 단계**다. 더더욱 상시 노출할 이유가 없다.

---

## 5. TS 타입 생성 시 함정

- **`CONTENT`** — 유일하게 전부 대문자. 다른 필드는 camelCase.
- **`echonum` vs `echoNum`** — `EcoLineRequestVO` 는 소문자 `n`, `EcoLineSearchVO` 는 대문자 `N`. 서로 다른 키다.
- **`serviceNo` 와 `echonum` 이 같은 값** (`CUSTCODE-YYYYMM-LINESEQ`) — 주석에 "화면용"이라 적혀 있다. 중복.
- **`testYn` 이 `EcoLineRequestVO` 와 `EcoLineAddInfoVO` 양쪽에 있고 의미가 다르다** (전자=이 건의 이관여부, 후자=고객사가 기능을 쓰는지).
- 날짜가 전부 `String` (`LocalDateTime` 은 `reqDateTime` 하나뿐) → 포맷 규약을 P1.s3 에서 확인.
- 시간 필드만 `Double` (`expeTime` `workTime` `rWorkTime` `surTime`).

---

## 6. 다음 (P1.s3)

- `ST001.jsp` 에서 `progress` 실제 값 목록 + `EcoLineUpdateVO.action` 값 목록 추출
- 69개 input 이 위 102필드 중 어디에 대응하는지 매핑
- `userType`(`B0001_03`=외부고객) 별 화면 차이
