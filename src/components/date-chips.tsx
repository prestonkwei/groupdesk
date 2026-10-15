"use client";

/**
 * Date chips in message bodies: the underlined date expressions, how they
 * get into a plain-text body (React) and into the sandboxed HTML iframe
 * (DOM annotation), and the hover/click behaviour that opens the popover.
 */
import { useMemo, type ReactNode } from "react";
import * as Popover from "@radix-ui/react-popover";
import { describeMatch, detectDates, detectZones, type DateMatch } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { DatePopoverContent } from "./date-popover";
import { useHoverPopover, type Anchor } from "./hover-popover";

export { useHoverPopover, type Anchor };

/** What the popover needs to know about the email a date came from. */
export type DateContext = {
  subject: string;
  sentAt: Date | string;
  ticketId: string;
  messageId: string;
  /** The sender's UTC offset from the email's Date header, if known. */
  sentOffsetMin: number | null;
  fromName: string | null;
};

/** Popover state belongs to one date in one message; a new key starts it fresh. */
const contentKey = (match: DateMatch, context: DateContext) => `${match.index}-${match.start}-${context.messageId}`;

/** Inline chip for plain-text bodies. */
export function DateChip({ match, context, children }: { match: DateMatch; context: DateContext; children: ReactNode }) {
  const h = useHoverPopover();
  return (
    <Popover.Root open={h.open} onOpenChange={(o) => (o ? h.pin() : h.close())}>
      <Popover.Trigger asChild>
        <button
          type="button"
          onMouseEnter={h.enter}
          onMouseLeave={h.leave}
          onClick={(e) => {
            // Radix's trigger would otherwise toggle right after this, closing an open popover.
            e.preventDefault();
            h.pin();
          }}
          className={cn(
            "date-chip rounded-sm border-b border-dashed border-[var(--primary)] text-[var(--primary)] hover:bg-[var(--accent)]",
            h.open && "bg-[var(--accent)]",
          )}
          title={describeMatch(match)}
        >
          {children}
        </button>
      </Popover.Trigger>
      <DatePopoverContent
        key={contentKey(match, context)}
        match={match}
        context={context}
        onEnter={h.enter}
        onLeave={h.leave}
      />
    </Popover.Root>
  );
}

/**
 * Popover for a chip that lives inside the email iframe: anchored to a box
 * placed over the chip's position, since the real element is in another document.
 */
export function AnchoredDatePopover({
  anchor,
  context,
  hover,
}: {
  anchor: Anchor | null;
  context: DateContext;
  hover: ReturnType<typeof useHoverPopover>;
}) {
  if (!anchor) return null;
  return (
    <Popover.Root open={hover.open} onOpenChange={(o) => (o ? hover.pin() : hover.close())}>
      <Popover.Anchor asChild>
        <span
          aria-hidden
          style={{
            position: "absolute",
            left: anchor.rect.left,
            top: anchor.rect.top,
            width: anchor.rect.width,
            height: anchor.rect.height,
            pointerEvents: "none",
          }}
        />
      </Popover.Anchor>
      <DatePopoverContent
        key={`${anchor.id}-${contentKey(anchor.match, context)}`}
        match={anchor.match}
        context={context}
        onEnter={hover.enter}
        onLeave={hover.leave}
      />
    </Popover.Root>
  );
}


/** Plain text with its dates wrapped in chips. */
export function TextWithDates({ text, context }: { text: string; context: DateContext }) {
  const sent = new Date(context.sentAt).getTime();
  const matches = useMemo(() => detectDates(text, new Date(sent)), [text, sent]);
  if (!matches.length) return <>{text}</>;
  const out: ReactNode[] = [];
  let at = 0;
  matches.forEach((m, i) => {
    if (m.index < at) return; // overlapping match
    out.push(text.slice(at, m.index));
    out.push(
      <DateChip key={i} match={m} context={context}>
        {m.text}
      </DateChip>,
    );
    at = m.index + m.text.length;
  });
  out.push(text.slice(at));
  return <>{out}</>;
}

/** Marks the chip whose popover is open (all of its spans) with .open; null clears it. */
export function markOpenChip(doc: Document, id: string | null) {
  doc.querySelectorAll<HTMLElement>(".date-chip").forEach((el) => el.classList.toggle("open", el.dataset.chip === id));
}

/** Elements whose text reads as one run: a date is looked for within, never across, them. */
const BLOCK = "p, div, li, td, th, blockquote, pre, h1, h2, h3, h4, h5, h6, body";
const QUOTE_LEAD = /^On .{5,200}wrote:/;

type Block = { el: Element; nodes: Text[]; starts: number[]; text: string; at: number };

/**
 * Wraps dates found in the iframe document in .date-chip spans and wires
 * their hover/click back to the parent. Detection runs on each block
 * element's whole text, so "Friday <b>Oct 23</b> at 2pm" is one date; a date
 * that spans several text nodes gets one span per node, all sharing the chip.
 * Returns a cleanup.
 */
export function annotateDocument(
  doc: Document,
  sentAt: Date | string,
  handlers: { enter: (a: Anchor) => void; leave: () => void; pin: (a: Anchor) => void },
): () => void {
  // The "On <date> <person> wrote:" line that heads quoted replies isn't a
  // date to book. Mail clients split it over several nodes, so look at the
  // whole line (the parent element's text), once per parent.
  const quoteLine = new Map<Element, boolean>();
  const isQuoteLine = (el: Element) => {
    let v = quoteLine.get(el);
    if (v === undefined) {
      v = /^On .{5,200}wrote:/s.test(el.textContent?.trim() ?? "");
      quoteLine.set(el, v);
    }
    return v;
  };

  const blocks = new Map<Element, Block>();
  const breaks = new Set<Element>(); // blocks with a <br> since their last text node
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
    acceptNode(node) {
      if (node.nodeType === Node.ELEMENT_NODE) {
        const el = node as Element;
        if (el.matches("a, style, script, .date-chip")) return NodeFilter.FILTER_REJECT;
        return el.tagName === "BR" ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
      }
      const parent = node.parentElement;
      if (!parent || !node.nodeValue) return NodeFilter.FILTER_REJECT;
      if (QUOTE_LEAD.test(node.nodeValue.trim()) || isQuoteLine(parent)) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (n.nodeType === Node.ELEMENT_NODE) {
      const el = n as Element;
      breaks.add(el.closest(BLOCK) ?? doc.body);
      continue;
    }
    const text = n as Text;
    const el = text.parentElement!.closest(BLOCK) ?? doc.body;
    let b = blocks.get(el);
    if (!b) blocks.set(el, (b = { el, nodes: [], starts: [], text: "", at: 0 }));
    if (breaks.delete(el) && b.nodes.length) b.text += "\n";
    b.nodes.push(text);
    b.starts.push(b.text.length);
    b.text += text.data;
  }

  // Zone mentions are looked up across the whole document, so "I'm in Central
  // time" in the next paragraph still applies to a time in this one.
  let joined = "";
  for (const b of blocks.values()) {
    b.at = joined.length;
    joined += b.text + "\n";
  }
  const zones = detectZones(joined);

  const cleanups: (() => void)[] = [];
  let chips = 0;
  for (const b of blocks.values()) {
    const matches = detectDates(b.text, sentAt, { whole: joined, zones, baseIndex: b.at }).filter(
      (m, k, all) => k === 0 || m.index >= all[k - 1].index + all[k - 1].text.length,
    );
    // Later matches first, and later segments first, so earlier offsets stay valid.
    for (const m of [...matches].reverse()) {
      const from = m.index;
      const to = m.index + m.text.length;
      const segments: { node: Text; from: number; to: number }[] = [];
      b.nodes.forEach((node, k) => {
        const s = Math.max(from, b.starts[k]) - b.starts[k];
        const e = Math.min(to, b.starts[k] + node.data.length) - b.starts[k];
        if (e > s && node.data.slice(s, e).trim()) segments.push({ node, from: s, to: e });
      });
      if (!segments.length) continue;

      const id = `c${chips++}`;
      const spans: HTMLElement[] = [];
      const anchor = (): Anchor => {
        const rects = spans.map((s) => s.getBoundingClientRect());
        const left = Math.min(...rects.map((r) => r.left));
        const top = Math.min(...rects.map((r) => r.top));
        const right = Math.max(...rects.map((r) => r.right));
        const bottom = Math.max(...rects.map((r) => r.bottom));
        return { id, match: m, rect: { left, top, width: right - left, height: bottom - top } };
      };
      const onEnter = () => handlers.enter(anchor());
      const onLeave = () => handlers.leave();
      const onClick = (e: Event) => {
        e.preventDefault();
        handlers.pin(anchor());
      };
      for (const seg of segments.reverse()) {
        const mid = seg.node.splitText(seg.from);
        mid.splitText(seg.to - seg.from);
        const span = doc.createElement("span");
        span.className = "date-chip";
        span.dataset.chip = id;
        span.title = describeMatch(m);
        mid.parentNode!.insertBefore(span, mid);
        span.appendChild(mid);
        span.addEventListener("mouseenter", onEnter);
        span.addEventListener("mouseleave", onLeave);
        span.addEventListener("click", onClick);
        spans.push(span);
      }
      cleanups.push(() => {
        for (const span of spans) {
          span.removeEventListener("mouseenter", onEnter);
          span.removeEventListener("mouseleave", onLeave);
          span.removeEventListener("click", onClick);
          // Put the text back as it was, so a re-run (same document) starts clean.
          span.replaceWith(...span.childNodes);
        }
      });
    }
  }
  return () => {
    cleanups.forEach((fn) => fn());
    doc.body.normalize();
  };
}
