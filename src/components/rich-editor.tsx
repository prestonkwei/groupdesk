"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { EditorContent, useEditor, useEditorState, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import {
  Bold,
  FileText,
  Italic,
  Link as LinkIcon,
  List,
  ListOrdered,
  Quote,
  Strikethrough,
  Underline,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { fillTemplate, type TemplateVars } from "@/lib/template-vars";

export type { Editor };
export type RichValue = { html: string; text: string; empty: boolean };
export type TemplateOption = { id: string; name: string; bodyHtml: string };

type SlashState = { query: string; from: number; top: number; left: number; index: number };

/**
 * Small rich-text editor for replies: bold/italic/underline/strike, lists,
 * quotes and links. Standard shortcuts work (⌘B, ⌘I, ⌘U, ⌘K for a link).
 */
export function RichEditor({
  placeholder,
  onChange,
  onSubmit,
  onEscape,
  autoFocusKey,
  resetKey,
  className,
  initialHtml,
  templates,
  variables,
  editorRef,
}: {
  placeholder: string;
  /** Exposes the editor, e.g. for "insert variable" buttons. */
  editorRef?: React.MutableRefObject<Editor | null>;
  /** Starting content, e.g. when editing a saved template. */
  initialHtml?: string;
  /** Enables the "/" menu: type / and a few letters to insert a template. */
  templates?: TemplateOption[];
  /** Values for {{variables}} in inserted templates, read at insert time. */
  variables?: () => TemplateVars;
  onChange: (v: RichValue) => void;
  onSubmit: () => void;
  onEscape: () => void;
  /** Changing this focuses the editor (e.g. when the composer opens). */
  autoFocusKey: number;
  /** Changing this clears the editor (e.g. after a send). */
  resetKey: number;
  className?: string;
}) {
  const [slash, setSlash] = useState<SlashState | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  // The editor's handlers are created once, so they read live values via refs.
  const live = useRef({ slash, matches: [] as TemplateOption[], templates, variables });
  const matches = slash && templates ? matchTemplates(templates, slash.query) : [];
  useEffect(() => {
    live.current = { slash, matches, templates, variables };
  });

  function insertTemplate(editor: Editor, t: TemplateOption) {
    const s = live.current.slash;
    if (!s) return;
    const html = fillTemplate(t.bodyHtml, live.current.variables?.() ?? {});
    editor.chain().focus().deleteRange({ from: s.from, to: editor.state.selection.from }).insertContent(html).run();
    setSlash(null);
  }

  /** Opens the menu while the caret sits right after "/word" at a word start. */
  function detectSlash(editor: Editor) {
    if (!live.current.templates) return;
    const { $from, empty } = editor.state.selection;
    if (!empty) return setSlash(null);
    const before = $from.parent.textBetween(Math.max(0, $from.parentOffset - 40), $from.parentOffset, undefined, "\ufffc");
    const m = before.match(/(?:^|\s)\/([\w-]{0,30})$/);
    if (!m) return setSlash(null);
    const coords = editor.view.coordsAtPos($from.pos);
    const box = boxRef.current?.getBoundingClientRect();
    setSlash((prev) => ({
      query: m[1],
      from: $from.pos - m[1].length - 1,
      top: coords.bottom - (box?.top ?? 0) + 4,
      left: Math.max(0, coords.left - (box?.left ?? 0) - 8),
      index: prev && prev.query === m[1] ? prev.index : 0,
    }));
  }

  const editor = useEditor({
    immediatelyRender: false,
    content: initialHtml,
    extensions: [
      StarterKit.configure({
        heading: false,
        codeBlock: false,
        horizontalRule: false,
        link: { openOnClick: false, autolink: true, defaultProtocol: "https" },
      }),
      Placeholder.configure({ placeholder }),
    ],
    editorProps: {
      attributes: {
        class:
          "rich-editor min-h-28 max-h-[45vh] overflow-y-auto px-3 py-2.5 text-[15px] leading-relaxed outline-none",
      },
      handleKeyDown: (_view, event) => {
        const { slash: s, matches: list } = live.current;
        if (s && editor) {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            const step = event.key === "ArrowDown" ? 1 : -1;
            setSlash({ ...s, index: (s.index + step + Math.max(list.length, 1)) % Math.max(list.length, 1) });
            return true;
          }
          if ((event.key === "Enter" || event.key === "Tab") && list[s.index]) {
            event.preventDefault();
            insertTemplate(editor, list[s.index]);
            return true;
          }
          if (event.key === "Escape") {
            setSlash(null);
            return true;
          }
        }
        if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
          event.preventDefault();
          onSubmit();
          return true;
        }
        if (event.key === "Escape") {
          onEscape();
          return true;
        }
        if (event.key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey)) {
          event.preventDefault();
          promptLink(editor);
          return true;
        }
        return false;
      },
    },
    onUpdate: ({ editor }) => {
      onChange({
        html: editor.getHTML(),
        text: editor.getText({ blockSeparator: "\n\n" }),
        empty: editor.isEmpty,
      });
      detectSlash(editor);
    },
    onSelectionUpdate: ({ editor }) => detectSlash(editor),
    onBlur: () => setTimeout(() => setSlash(null), 150),
  });

  useEffect(() => {
    if (editorRef) editorRef.current = editor;
  }, [editor, editorRef]);

  useEffect(() => {
    if (editor && autoFocusKey) editor.commands.focus("end");
  }, [editor, autoFocusKey]);

  useEffect(() => {
    if (editor && resetKey) {
      editor.commands.clearContent(true);
    }
  }, [editor, resetKey]);

  return (
    <div ref={boxRef} className={cn("relative flex flex-col", className)}>
      <Toolbar editor={editor} hasTemplates={!!templates} />
      <EditorContent editor={editor} />
      {slash && editor && (
        <div
          className="absolute z-40 w-72 overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--card)] p-1 shadow-lg"
          style={{ top: slash.top, left: slash.left }}
          onMouseDown={(e) => e.preventDefault()}
        >
          <p className="px-2 pb-1 pt-0.5 text-[11px] font-medium uppercase tracking-wide text-[var(--muted-foreground)]">
            Templates{slash.query ? ` matching “${slash.query}”` : ""}
          </p>
          {matches.length ? (
            <ul className="max-h-64 overflow-y-auto">
              {matches.map((t, i) => (
                <li key={t.id}>
                  <button
                    type="button"
                    onMouseEnter={() => setSlash({ ...slash, index: i })}
                    onClick={() => insertTemplate(editor, t)}
                    className={cn(
                      "block w-full rounded-md px-2 py-1.5 text-left",
                      i === slash.index && "bg-[var(--accent)]",
                    )}
                  >
                    <span className="block truncate text-sm font-medium">{t.name}</span>
                    <span className="block truncate text-xs text-[var(--muted-foreground)]">
                      {plainText(t.bodyHtml)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-2 py-2 text-xs text-[var(--muted-foreground)]">
              {templates?.length ? "No template matches." : "No templates yet."}{" "}
              <Link href="/templates" className="underline">
                Manage templates
              </Link>
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function plainText(html: string) {
  return html.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim().slice(0, 90);
}

/** Name matches first (prefix, then anywhere), then body text. */
function matchTemplates(list: TemplateOption[], query: string) {
  const q = query.toLowerCase().replace(/[-_]/g, " ");
  if (!q) return list.slice(0, 8);
  const scored = list
    .map((t) => {
      const name = t.name.toLowerCase();
      const score = name.startsWith(q) ? 3 : name.includes(q) ? 2 : plainText(t.bodyHtml).toLowerCase().includes(q) ? 1 : 0;
      return { t, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.t.name.localeCompare(b.t.name));
  return scored.slice(0, 8).map((x) => x.t);
}

function promptLink(editor: Editor | null) {
  if (!editor) return;
  const previous = editor.getAttributes("link").href as string | undefined;
  const url = window.prompt("Link URL", previous ?? "https://");
  if (url === null) return;
  if (url.trim() === "" || url === "https://") {
    editor.chain().focus().extendMarkRange("link").unsetLink().run();
    return;
  }
  editor.chain().focus().extendMarkRange("link").setLink({ href: url.trim() }).run();
}

function Toolbar({ editor, hasTemplates }: { editor: Editor | null; hasTemplates: boolean }) {
  const active = useEditorState({
    editor,
    selector: ({ editor: e }) =>
      e
        ? {
            bold: e.isActive("bold"),
            italic: e.isActive("italic"),
            underline: e.isActive("underline"),
            strike: e.isActive("strike"),
            bullet: e.isActive("bulletList"),
            ordered: e.isActive("orderedList"),
            quote: e.isActive("blockquote"),
            link: e.isActive("link"),
          }
        : null,
  });
  if (!editor) return <div className="h-9 border-b border-[var(--border)]" />;

  const buttons: {
    key: keyof NonNullable<typeof active>;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    run: () => void;
    sep?: boolean;
  }[] = [
    { key: "bold", label: "Bold (⌘B)", icon: Bold, run: () => editor.chain().focus().toggleBold().run() },
    { key: "italic", label: "Italic (⌘I)", icon: Italic, run: () => editor.chain().focus().toggleItalic().run() },
    { key: "underline", label: "Underline (⌘U)", icon: Underline, run: () => editor.chain().focus().toggleUnderline().run() },
    { key: "strike", label: "Strikethrough", icon: Strikethrough, run: () => editor.chain().focus().toggleStrike().run() },
    { key: "bullet", label: "Bulleted list", icon: List, run: () => editor.chain().focus().toggleBulletList().run(), sep: true },
    { key: "ordered", label: "Numbered list", icon: ListOrdered, run: () => editor.chain().focus().toggleOrderedList().run() },
    { key: "quote", label: "Quote", icon: Quote, run: () => editor.chain().focus().toggleBlockquote().run() },
    { key: "link", label: "Link (⌘K)", icon: LinkIcon, run: () => promptLink(editor), sep: true },
  ];

  return (
    <div className="flex h-9 items-center gap-0.5 border-b border-[var(--border)] px-1.5">
      {buttons.map((b) => (
        <span key={b.key} className="flex items-center">
          {b.sep && <span className="mx-1 h-4 w-px bg-[var(--border)]" />}
          <button
            type="button"
            title={b.label}
            aria-label={b.label}
            aria-pressed={!!active?.[b.key]}
            onMouseDown={(e) => e.preventDefault()}
            onClick={b.run}
            className={cn(
              "grid size-7 place-items-center rounded-md text-[var(--muted-foreground)] hover:bg-[var(--accent)] hover:text-[var(--foreground)]",
              active?.[b.key] && "bg-[var(--accent)] text-[var(--foreground)]",
            )}
          >
            <b.icon className="size-3.5" />
          </button>
        </span>
      ))}
      {hasTemplates && (
        <button
          type="button"
          title="Insert a template (type / anywhere)"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            const { $from } = editor.state.selection;
            const prev = $from.parent.textBetween(Math.max(0, $from.parentOffset - 1), $from.parentOffset);
            editor.chain().focus().insertContent(prev && !/\s/.test(prev) ? " /" : "/").run();
          }}
          className="ml-auto flex h-7 items-center gap-1.5 rounded-md px-2 text-xs text-[var(--muted-foreground)] hover:bg-[var(--accent)] hover:text-[var(--foreground)]"
        >
          <FileText className="size-3.5" />
          Templates
          <kbd className="rounded border border-[var(--border)] px-1 text-[10px]">/</kbd>
        </button>
      )}
    </div>
  );
}
