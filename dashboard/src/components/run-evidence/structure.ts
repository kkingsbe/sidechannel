/** Pure text-structure helpers: agent prose becomes lead, key/value rows, case grids, lists and sections. */

export type CaseValue = { key: string; value: string };
export type PostBlock =
  | { type: "lead"; text: string }
  | { type: "cases"; items: CaseValue[] }
  | { type: "kv"; rows: { key: string; text: string; items: string[] }[] }
  | { type: "list"; items: string[] }
  | { type: "p"; text: string };

const CASE_PAIR = /(C-[A-Z0-9]{5})\s*[:=]\s*(-?\d+)/g;
const CASE_LINE =
  /^(?:[-*•]\s*)?(?:C-[A-Z0-9]{5}\s*[:=]\s*-?\d+\s*(?:[,;·]\s*|\s+)?)+\.?$/;
const BULLET = /^\s*(?:[-*•]|\d+[.)])\s+(.*)$/;
const KEY_LINE =
  /^(?:\*\*)?([A-Z][A-Za-z0-9 &/'’_-]{1,44}?(?:\s\([^)]{1,70}\))?)(?:\*\*)?:\s*(.*)$/;

const stripMd = (text: string) => text.replace(/\*\*/g, "").trim();

const looksLikeKey = (key: string) => {
  const bare = key.replace(/\s\([^)]*\)$/, "");
  if (bare.split(/\s+/).length > 6) return false;
  if (/[.!?]/.test(bare)) return false;
  // An all-caps key, or a short Title-case label ("My status", "Limitations & integrity notes").
  return bare === bare.toUpperCase() || bare.split(/\s+/).length <= 4;
};

/** Break a board post into a lead, "KEY: value" rows, case-value grids, lists and prose. */
export function parsePost(text: string): PostBlock[] {
  const lines = text.replace(/\r/g, "").split("\n");
  const blocks: PostBlock[] = [];
  let i = 0;
  while (i < lines.length && !lines[i]!.trim()) i++;
  const first = lines[i]?.trim() ?? "";
  if (
    first &&
    (/^\[[^\]]+\]/.test(first) || /^\*\*/.test(first) || /^#+\s/.test(first)) &&
    first.length <= 600
  ) {
    blocks.push({ type: "lead", text: stripMd(first.replace(/^#+\s*/, "")) });
    i++;
  }
  let para: string[] = [];
  const flush = () => {
    if (para.length) blocks.push({ type: "p", text: para.join(" ").trim() });
    para = [];
  };
  const last = () => blocks[blocks.length - 1];
  for (; i < lines.length; i++) {
    const raw = lines[i]!;
    const line = raw.trim();
    if (!line) {
      flush();
      continue;
    }
    if (CASE_LINE.test(line)) {
      flush();
      const items = [...line.matchAll(CASE_PAIR)].map((m) => ({
        key: m[1]!,
        value: m[2]!,
      }));
      const prev = last();
      if (prev?.type === "cases") prev.items.push(...items);
      else blocks.push({ type: "cases", items });
      continue;
    }
    const bullet = BULLET.exec(raw);
    if (bullet) {
      flush();
      const prev = last();
      const item = bullet[1]!.trim();
      if (prev?.type === "kv" && prev.rows.at(-1) && !prev.rows.at(-1)!.text)
        prev.rows.at(-1)!.items.push(item);
      else if (prev?.type === "list") prev.items.push(item);
      else blocks.push({ type: "list", items: [item] });
      continue;
    }
    const key = KEY_LINE.exec(line);
    if (key && looksLikeKey(key[1]!)) {
      flush();
      const row = { key: stripMd(key[1]!), text: stripMd(key[2]!), items: [] as string[] };
      const prev = last();
      if (prev?.type === "kv") prev.rows.push(row);
      else blocks.push({ type: "kv", rows: [row] });
      continue;
    }
    para.push(line);
  }
  flush();
  // A kv header with nothing under it is just prose.
  return blocks.map((block) =>
    block.type === "kv" && block.rows.length === 1 && !block.rows[0]!.text && !block.rows[0]!.items.length
      ? ({ type: "p", text: block.rows[0]!.key + ":" } as PostBlock)
      : block,
  );
}

export interface Segment {
  key: string;
  body: string;
}

/**
 * Split free text on ALL-CAPS headings ("ACCESS LOG:", "RECEIPT LOG (note):") that start a line or a
 * sentence. Text before the first heading becomes a segment with an empty key.
 */
export function splitHeaded(text: string): Segment[] {
  const marker =
    /(^|\n|(?<=[.;!?)] ))([A-Z][A-Z0-9 &/'’_-]{2,40}[A-Z0-9])(\s\([^)\n]{1,100}\))?:(?=\s|$)/g;
  const found: { index: number; end: number; key: string; tail: string }[] = [];
  for (const match of text.matchAll(marker)) {
    const start = match.index! + match[1]!.length;
    found.push({
      index: start,
      end: match.index! + match[0].length,
      key: match[2]!,
      tail: (match[3] ?? "").trim(),
    });
  }
  const out: Segment[] = [];
  const head = text.slice(0, found[0]?.index ?? text.length).trim();
  if (head) out.push({ key: "", body: head });
  found.forEach((hit, n) => {
    const next = found[n + 1]?.index ?? text.length;
    const body = (hit.tail ? hit.tail + ": " : "") + text.slice(hit.end, next).trim();
    out.push({ key: hit.key, body: body.replace(/^:\s*/, "").trim() });
  });
  return out;
}

export const sentenceCase = (key: string) => {
  const lower = key.toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
};

/** Lines of a note body as list items when most lines are bullets, otherwise as paragraphs. */
export function bodyLines(body: string) {
  const lines = body.split("\n").map((line) => line.trim()).filter(Boolean);
  const bullets = lines.filter((line) => BULLET.test(line));
  return {
    bullets: bullets.length > 0 && bullets.length >= lines.length / 2,
    lines: lines.map((line) => line.replace(BULLET, "$1")),
  };
}

/** "(1) first (2) second" or "1) first 2) second" numbering, when the text has it. */
export function splitNumbered(text: string): string[] | undefined {
  const re = /(?:^|\s)\((\d{1,2})\)\s+|(?:^|\s)(\d{1,2})\)\s+/g;
  const hits = [...text.matchAll(re)];
  if (hits.length < 2) return undefined;
  const numbers = hits.map((hit) => Number(hit[1] ?? hit[2]));
  if (numbers[0] !== 1 || numbers.some((n, k) => n !== k + 1)) return undefined;
  const parts: string[] = [];
  hits.forEach((hit, k) => {
    const start = hit.index! + hit[0].length;
    const end = hits[k + 1]?.index ?? text.length;
    parts.push(text.slice(start, end).trim().replace(/[;,]$/, ""));
  });
  const preface = text.slice(0, hits[0]!.index).trim();
  return preface ? [preface, ...parts] : parts;
}

/** "Missing contribution. rest of the point" -> lead phrase and rest, when the first sentence is short. */
export function leadPhrase(point: string): { lead: string; rest: string } {
  const colon = /^([^:.]{3,60}):\s+(.*)$/s.exec(point);
  if (colon) return { lead: colon[1]!, rest: colon[2]! };
  const sentence = /^([^.]{3,70}\.)\s+(.*)$/s.exec(point);
  if (sentence) return { lead: sentence[1]!, rest: sentence[2]! };
  return { lead: "", rest: point };
}

export const wordCount = (text: string) =>
  text.trim() ? text.trim().split(/\s+/).length : 0;
