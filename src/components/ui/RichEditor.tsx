"use client";

import { Placeholder } from "@tiptap/extensions";
import {
  EditorContent,
  useEditor,
  useEditorState,
  type Editor,
} from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import {
  Bold,
  Italic,
  Link2,
  Link2Off,
  List,
  ListOrdered,
  Redo2,
  Strikethrough,
  Underline as UnderlineIcon,
  Undo2,
} from "lucide-react";
import { useEffect, useRef } from "react";
import { cn } from "@/lib/cn";
import { sanitize } from "@/lib/sanitize";

/**
 * 리치 텍스트 에디터 (Tiptap 3).
 *
 * 저장 포맷이 HTML 이라 기존 2.3만 건과 호환된다 (`tech-stack.md` §2).
 *
 * 🔴 두 가지를 반드시 지킨다
 *  1. **초기값은 sanitize() 를 거친다** — 저장값이 이스케이프된 HTML 인 레코드가 있고
 *     (`&lt;div&gt;`), 그대로 넣으면 태그가 글자로 보인다. sanitize() 가 풀고 걸러 준다.
 *  2. **붙여넣은 이미지는 막는다** — 외부(메일/웹)에서 복사한 이미지는 서버에 저장되지 않는다.
 *     원본은 저장 버튼을 누른 뒤에야 알려줬다 → 붙여넣기 시점에 즉시 알린다.
 *  3. **부모가 값을 바꾸면 따라간다** — Tiptap 은 content 를 생성 때 한 번만 읽는다.
 *     그대로 두면 댓글을 등록해 부모가 초안을 비워도 입력창에 방금 쓴 글이 남고,
 *     이어 쓰면 **앞 글까지 다시 등록**된다(실측). 내가 방금 올려 보낸 값이 되돌아온
 *     것이면 건드리지 않는다 — 타이핑마다 다시 채우면 커서가 튄다.
 */
export function RichEditor({
  value,
  onChange,
  placeholder = "내용을 입력하세요",
  disabled,
  minHeight = 120,
  onImagePaste,
  ariaLabel,
  className,
  focusKey = 0,
}: {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  disabled?: boolean;
  minHeight?: number;
  onImagePaste?: () => void;
  ariaLabel?: string;
  className?: string;
  /** 값이 바뀔 때마다 끝으로 커서를 옮겨 포커스한다 (0 = 요청 없음) */
  focusKey?: number;
}) {
  /** 에디터가 마지막으로 올려 보낸 값 — 되돌아온 값인지 가려낸다 */
  const emitted = useRef(value);
  const editor = useEditor({
    // SSR 에서 즉시 렌더하면 하이드레이션이 어긋난다 — Tiptap 공식 권장 옵션
    immediatelyRender: false,
    editable: !disabled,
    extensions: [
      // StarterKit 3 는 Link·Underline·UndoRedo 를 이미 포함한다 (중복 등록 금지)
      StarterKit.configure({
        heading: { levels: [3, 4] },
        link: {
          openOnClick: false,
          autolink: true,
          HTMLAttributes: { rel: "noreferrer noopener", target: "_blank" },
        },
      }),
      Placeholder.configure({ placeholder }),
    ],
    content: sanitize(value),
    editorProps: {
      attributes: {
        class: "prose-nx nx-editor-body",
        ...(ariaLabel ? { "aria-label": ariaLabel } : {}),
      },
      handlePaste: (_view, event) => {
        const items = Array.from(event.clipboardData?.items ?? []);
        if (items.some((i) => i.type.startsWith("image/"))) {
          event.preventDefault();
          onImagePaste?.();
          return true; // 기본 붙여넣기를 막는다
        }
        return false;
      },
    },
    onUpdate: ({ editor: e }) => {
      const html = e.getHTML();
      emitted.current = html;
      onChange(html);
    },
  });

  useEffect(() => {
    if (!editor || editor.isDestroyed || value === emitted.current) return;
    emitted.current = value;
    // 바깥에서 바꾼 값이라 다시 올려 보내지 않는다 (초안이 '변경 있음'으로 되살아나지 않게).
    // 실행 취소 이력에도 넣지 않는다 — 넣으면 비운 입력창에서 '실행 취소' 한 번에 방금 등록한
    // 글이 되살아나 다시 등록할 수 있게 된다(리뷰 재현)
    editor
      .chain()
      .setMeta("addToHistory", false)
      .setContent(sanitize(value), { emitUpdate: false })
      .run();
  }, [editor, value]);

  // ⚠️ 값 동기화 effect **뒤에** 둔다 — 부모가 초안을 채우며 포커스를 요청하면
  //    채운 글의 끝에 커서가 놓여야 한다(같은 커밋에서 선언 순서대로 돈다).
  useEffect(() => {
    if (!editor || editor.isDestroyed || !focusKey) return;
    editor.commands.focus("end");
  }, [editor, focusKey]);

  if (!editor) {
    // immediatelyRender:false 라 첫 렌더에는 editor 가 없다 → 자리만 잡아 레이아웃이 튀지 않게
    return (
      <div
        className={cn("nx-editor", className)}
        style={{ minHeight: minHeight + 34 }}
        aria-busy="true"
      />
    );
  }

  return (
    <div
      className={cn("nx-editor", className)}
      data-disabled={disabled ? "true" : undefined}
      style={{ ["--nx-editor-min" as string]: `${minHeight}px` }}
    >
      {!disabled ? <Toolbar editor={editor} /> : null}
      <EditorContent editor={editor} />
    </div>
  );
}

function Toolbar({ editor }: { editor: Editor }) {
  /**
   * ⚠️ Tiptap v3 는 shouldRerenderOnTransaction 기본값이 false 라 트랜잭션마다
   *    리렌더하지 않는다. editor.isActive() 를 렌더 중에 직접 읽으면 툴바의 활성 표시가
   *    **영영 갱신되지 않는다.** 공식 해법인 useEditorState 로 구독한다.
   */
  const s = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive("bold"),
      italic: e.isActive("italic"),
      underline: e.isActive("underline"),
      strike: e.isActive("strike"),
      bulletList: e.isActive("bulletList"),
      orderedList: e.isActive("orderedList"),
      link: e.isActive("link"),
      canUndo: e.can().undo(),
      canRedo: e.can().redo(),
    }),
  });

  const btn = (
    active: boolean,
    label: string,
    onClick: () => void,
    Icon: typeof Bold,
    enabled = true,
  ) => (
    <button
      key={label}
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      disabled={!enabled}
      // onMouseDown 으로 막아야 에디터가 포커스를 잃지 않는다
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={cn(
        "hover:bg-hover text-fg-muted flex h-6 w-6 items-center justify-center rounded-xs disabled:opacity-40",
        active && "bg-selected text-accent-text",
      )}
    >
      <Icon size={13} aria-hidden />
    </button>
  );

  return (
    <div className="border-line-subtle bg-subtle flex flex-wrap items-center gap-0.5 border-b px-1.5 py-1">
      {btn(
        s.bold,
        "굵게",
        () => editor.chain().focus().toggleBold().run(),
        Bold,
      )}
      {btn(
        s.italic,
        "기울임",
        () => editor.chain().focus().toggleItalic().run(),
        Italic,
      )}
      {btn(
        s.underline,
        "밑줄",
        () => editor.chain().focus().toggleUnderline().run(),
        UnderlineIcon,
      )}
      {btn(
        s.strike,
        "취소선",
        () => editor.chain().focus().toggleStrike().run(),
        Strikethrough,
      )}
      <span className="bg-line mx-1 h-3.5 w-px" aria-hidden />
      {btn(
        s.bulletList,
        "글머리 목록",
        () => editor.chain().focus().toggleBulletList().run(),
        List,
      )}
      {btn(
        s.orderedList,
        "번호 목록",
        () => editor.chain().focus().toggleOrderedList().run(),
        ListOrdered,
      )}
      <span className="bg-line mx-1 h-3.5 w-px" aria-hidden />
      {btn(
        s.link,
        "링크",
        () => {
          const prev = (editor.getAttributes("link").href as string) ?? "";
          const url = window.prompt("링크 주소", prev);
          if (url === null) return;
          if (url === "") {
            editor.chain().focus().unsetLink().run();
            return;
          }
          editor.chain().focus().setLink({ href: url }).run();
        },
        Link2,
      )}
      {btn(
        false,
        "링크 해제",
        () => editor.chain().focus().unsetLink().run(),
        Link2Off,
        s.link,
      )}
      <span className="ml-auto flex items-center gap-0.5">
        {btn(
          false,
          "실행 취소",
          () => editor.chain().focus().undo().run(),
          Undo2,
          s.canUndo,
        )}
        {btn(
          false,
          "다시 실행",
          () => editor.chain().focus().redo().run(),
          Redo2,
          s.canRedo,
        )}
      </span>
    </div>
  );
}
