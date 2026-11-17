// Ported from codex-bridge/web/composer-commands.ts. The recovered matcher
// ranks registered commands; only commands backed by host callbacks are shown.
export interface ComposerCommand {
  id: string;
  title: string;
  searchAliases?: string[];
  enabled?: boolean;
  requiresEmptyComposer?: boolean;
}
export interface SlashQuery { from: number; to: number; query: string }

const SIMPLE = /(?:^|\s)(\/)([\p{L}\p{N}\p{M}.:_/\\-]*)$/u;
const SPACED = /(?:^|\s)(\/)(?!\s)([\p{L}\p{N}\p{M}.:_\\ -]*)$/u;
const ONLY_SLASH = /^\s*\/[^/\r\n]*\s*$/;

function inCodeFence(text: string) {
  let fence: { marker: string; length: number } | undefined;
  for (const line of text.split('\n')) {
    const match = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (!match) continue;
    const marker = match[1][0], length = match[1].length;
    if (!fence) fence = { marker, length };
    else if (marker === fence.marker && length >= fence.length && !match[2].trim()) fence = undefined;
  }
  return Boolean(fence);
}

export function slashQuery(text: string, caret: number, selectionEnd = caret): SlashQuery | null {
  if (caret !== selectionEnd || caret < 0 || caret > text.length) return null;
  const before = text.slice(0, caret);
  if (inCodeFence(before)) return null;
  const paragraph = before.slice(before.lastIndexOf('\n') + 1);
  const match = paragraph.match(SIMPLE) ?? paragraph.match(SPACED);
  if (!match || match[2].startsWith('/')) return null;
  return { from: caret - match[2].length - 1, to: caret, query: match[2] };
}

export function hasComposerDraft(text: string) {
  return text.trim().length !== 0 && !ONLY_SLASH.test(text);
}

export function removeSlashQuery(text: string, match: SlashQuery) {
  return { text: text.slice(0, match.from) + text.slice(match.to), caret: match.from };
}

export function commandScore(value: string, query: string) {
  const haystack = value.toLocaleLowerCase(), needle = query.trim().toLocaleLowerCase();
  if (!needle) return 1;
  if (haystack === needle) return 10000;
  if (haystack.startsWith(needle)) return 5000 - value.length;
  const at = haystack.indexOf(needle);
  if (at >= 0) return 3000 - at - value.length;
  let pos = 0, gaps = 0;
  for (const character of needle) {
    const next = haystack.indexOf(character, pos);
    if (next < 0) return 0;
    gaps += next - pos;
    pos = next + 1;
  }
  return Math.max(1, 1000 - gaps - value.length);
}

export function filterCommands<T extends ComposerCommand>(commands: readonly T[], query: string, draftText = ''): T[] {
  const unique = new Map<string, T>();
  for (const command of commands) {
    if (command.enabled === false || (hasComposerDraft(draftText) && command.requiresEmptyComposer)) continue;
    unique.set(command.id, command);
  }
  return [...unique.values()]
    .map(command => ({ command, score: Math.max(...[command.title, command.id, ...command.searchAliases ?? []].map(label => commandScore(label, query))) }))
    .filter(entry => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.command.title.localeCompare(b.command.title))
    .map(entry => entry.command);
}
