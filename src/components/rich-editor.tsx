"use client";

import { useEffect } from "react";
import { EditorContent, useEditor, useEditorState, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import {
  Bold,
  Italic,
  Link as LinkIcon,
  List,
  ListOrdered,
  Quote,
  Strikethrough,
  Underline,
} from "lucide-react";
import { cn } from "@/lib/utils";

export type RichValue = { html: string; text: string; empty: boolean };

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
}: {
  placeholder: string;
  onChange: (v: RichValue) => void;
  onSubmit: () => void;
  onEscape: () => void;
  /** Changing this focuses the editor (e.g. when the composer opens). */
  autoFocusKey: number;
  /** Changing this clears the editor (e.g. after a send). */
  resetKey: number;
  className?: string;
}) {
  const editor = useEditor({
    immediatelyRender: false,
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
    onUpdate: ({ editor }) =>
      onChange({
        html: editor.getHTML(),
        text: editor.getText({ blockSeparator: "\n\n" }),
        empty: editor.isEmpty,
      }),
  });

  useEffect(() => {
    if (editor && autoFocusKey) editor.commands.focus("end");
  }, [editor, autoFocusKey]);

  useEffect(() => {
    if (editor && resetKey) {
      editor.commands.clearContent(true);
    }
  }, [editor, resetKey]);

  return (
    <div className={cn("flex flex-col", className)}>
      <Toolbar editor={editor} />
      <EditorContent editor={editor} />
    </div>
  );
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

function Toolbar({ editor }: { editor: Editor | null }) {
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
    </div>
  );
}
