"use client";

import { useState } from "react";
import { Combobox } from "@/components/ui/Combobox";
import { Modal, Sheet } from "@/components/ui/Sheet";
import { TokenInput } from "@/components/ui/TokenInput";
import { Segmented, TabPanel, Tabs } from "@/components/ui/Tabs";
import { MODULE } from "@/lib/codes";

/** 상호작용이 있는 컴포넌트만 모아둔 놀이터 */
export function Playground() {
  const [module, setModule] = useState("");
  const [emails, setEmails] = useState<string[]>(["ops@nexio.example"]);
  const [view, setView] = useState<"open" | "mine" | "all">("open");
  const [tab, setTab] = useState("request");
  const [sheet, setSheet] = useState(false);
  const [modal, setModal] = useState(false);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="btn btn-primary">
          기본 액션
        </button>
        <button type="button" className="btn btn-outline">
          보조
        </button>
        <button type="button" className="btn btn-ghost">
          약함
        </button>
        <button type="button" className="btn btn-danger-soft">
          취소
        </button>
        <button type="button" className="btn btn-danger">
          삭제
        </button>
        <button type="button" className="btn btn-primary" disabled>
          비활성
        </button>
        <button type="button" className="btn btn-outline btn-sm">
          작게
        </button>
        <button type="button" className="btn btn-outline btn-lg">
          크게
        </button>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="pg-input" className="label label-req">
            일반 입력
          </label>
          <input
            id="pg-input"
            className="input"
            placeholder="제목을 입력하세요"
          />
          <p className="field-hint">힌트 문구는 이 자리에 표시됩니다</p>
        </div>
        <div>
          <label htmlFor="pg-invalid" className="label label-req">
            오류 상태
          </label>
          <input
            id="pg-invalid"
            className="input"
            aria-invalid="true"
            defaultValue="잘못된 값"
          />
          <p className="field-error">제목을 입력해 주세요</p>
        </div>
        <div>
          <label htmlFor="pg-select" className="label">
            네이티브 select
          </label>
          <select id="pg-select" className="input">
            <option>선택하세요</option>
            <option>재무관리</option>
          </select>
        </div>
        <div>
          <span className="label">Combobox — 26개 모듈 검색</span>
          <Combobox
            options={Object.entries(MODULE).map(([value, label]) => ({
              value,
              label,
            }))}
            value={module}
            onChange={setModule}
            placeholder="모듈 선택"
          />
        </div>
        <div className="sm:col-span-2">
          <span className="label">토큰 입력 — 참조자</span>
          <TokenInput values={emails} onChange={setEmails} />
        </div>
        <div className="sm:col-span-2">
          <label htmlFor="pg-ta" className="label">
            여러 줄 입력
          </label>
          <textarea
            id="pg-ta"
            className="input"
            placeholder="증상을 적어 주세요"
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <Segmented
          ariaLabel="예시 뷰"
          value={view}
          onChange={setView}
          options={[
            { value: "open", label: "진행 중", count: 171 },
            { value: "mine", label: "내 담당", count: 56 },
            { value: "all", label: "전체", count: 5199 },
          ]}
        />
        <button
          type="button"
          className="btn btn-outline"
          onClick={() => setSheet(true)}
        >
          Sheet 열기
        </button>
        <button
          type="button"
          className="btn btn-outline"
          onClick={() => setModal(true)}
        >
          Modal 열기
        </button>
      </div>

      <div className="card overflow-hidden">
        <Tabs
          tabs={[
            { value: "request", label: "요청내용" },
            { value: "solution", label: "처리결과" },
            { value: "comments", label: "댓글", count: 3, dot: true },
            { value: "history", label: "이력" },
          ]}
          value={tab}
          onValueChange={setTab}
        >
          <TabPanel value="request">
            <p className="text-13">탭 본문. 102필드를 5개 탭에 수납합니다.</p>
          </TabPanel>
          <TabPanel value="solution">
            <p className="text-13">
              상태 4 이상이면 이 탭이 기본으로 선택됩니다.
            </p>
          </TabPanel>
          <TabPanel value="comments">
            <p className="text-13">미읽음이 있으면 라벨에 점이 붙습니다.</p>
          </TabPanel>
          <TabPanel value="history">
            <p className="text-13">안 쓰는 단계는 그리지 않습니다.</p>
          </TabPanel>
        </Tabs>
      </div>

      <Sheet
        open={sheet}
        onOpenChange={setSheet}
        title="시트 예시"
        header={
          <p className="text-11 text-fg-muted mt-1">
            우측에서 슬라이드로 열립니다
          </p>
        }
        footer={
          <div className="flex justify-end gap-2">
            <button
              type="button"
              className="btn btn-outline"
              onClick={() => setSheet(false)}
            >
              닫기
            </button>
            <button type="button" className="btn btn-primary">
              확인
            </button>
          </div>
        }
      >
        <div className="text-13 p-5">
          목록 위에 덮이므로 목록의 스크롤·필터가 그대로 유지됩니다. Esc·포커스
          트랩은 Radix 가 처리합니다.
        </div>
      </Sheet>

      <Modal
        open={modal}
        onOpenChange={setModal}
        title="요청을 취소할까요?"
        description="취소는 신청자 본인만 실행할 수 있습니다. 취소 후에는 재신청으로만 이어갈 수 있습니다."
        footer={
          <>
            <button
              type="button"
              className="btn btn-outline"
              onClick={() => setModal(false)}
            >
              돌아가기
            </button>
            <button type="button" className="btn btn-danger">
              취소하기
            </button>
          </>
        }
      />
    </div>
  );
}
