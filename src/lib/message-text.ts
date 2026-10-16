/** Plain-text views of a message body, shared by the thread UI and server code. */

/** Splits plain text at the first quoted-reply marker ("On … wrote:" or "> "). */
export function splitQuote(text: string): [string, string | null] {
  const lines = text.split(/\r?\n/);
  const at = lines.findIndex(
    (l, i) =>
      /^On .{5,200}wrote:\s*$/.test(l.trim()) ||
      /^-{2,}\s*Original Message\s*-{2,}$/i.test(l.trim()) ||
      (l.startsWith(">") && lines.slice(i).every((x) => !x.trim() || x.startsWith(">"))),
  );
  if (at <= 0) return [text, null];
  return [lines.slice(0, at).join("\n").trimEnd(), lines.slice(at).join("\n")];
}

/** "Re: Re: [Help] Thing" -> "Thing", for a sensible default event title. Strips a leading [tag] and any Re:/Fwd: prefixes, in any order. */
export function stripReplyPrefix(subject: string): string {
  let s = subject.trim();
  for (;;) {
    const next = s.replace(/^(?:(?:re|fwd?|aw|wg)\s*:|\[[^\]]*\])\s*/i, "");
    if (next === s) return s;
    s = next;
  }
}

const NAMED_ENTITIES: Record<string, string> = {
  nbsp: " ",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  rsquo: "\u2019",
  lsquo: "\u2018",
  rdquo: "\u201d",
  ldquo: "\u201c",
  ndash: "\u2013",
  mdash: "\u2014",
  hellip: "\u2026",
};

/** Unescapes entities in one pass; `&amp;` is just another entry, so `&amp;lt;` becomes `&lt;`, not `<`. */
function decodeEntities(s: string): string {
  return s.replace(/&(?:#(\d{1,7})|#x([0-9a-f]{1,6})|([a-z]+));/gi, (whole, dec, hex, name) => {
    if (dec || hex) {
      const code = dec ? parseInt(dec, 10) : parseInt(hex, 16);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    const lower = String(name).toLowerCase();
    return lower === "amp" ? "&" : (NAMED_ENTITIES[lower] ?? whole);
  });
}

/** HTML to text, dropping the quoted history and styles; entities unescaped. */
export function htmlToText(html: string): string {
  const text = html
    .split(/<(?:div|blockquote)[^>]*class="[^"]*(?:gmail_quote|yahoo_quoted)|<blockquote[^>]*type="cite"|<div[^>]*id="appendonsend"/i)[0]
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<\/(p|div|li|tr|h\d|br)>|<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  return decodeEntities(text)
    .replace(/[ \t]+/g, " ")
    // "<b>Oct 23</b>, so" leaves a space before the comma once tags go.
    .replace(/ ([,.;:!?])/g, "$1")
    .replace(/\s*\n\s*/g, "\n")
    .trim();
}

/** The new part of a message as plain text (no quoted history). */
export function messageText(m: { bodyText: string | null; bodyHtml: string | null }): string {
  if (m.bodyHtml) return htmlToText(m.bodyHtml);
  return splitQuote(m.bodyText ?? "")[0];
}
