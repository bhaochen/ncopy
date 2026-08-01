/**
 * Converts assistant markdown into plain, speakable text for Edge TTS
 * read-aloud (`/live`).
 *
 * Read-aloud should not stumble over formatting: code blocks, inline code,
 * emphasis markers, link URLs, images, headings, list bullets, blockquotes,
 * and table pipes all get stripped or reduced to their visible text, then all
 * whitespace collapses to single spaces so the speech is one continuous,
 * natural paragraph.
 *
 * Length is NOT capped here: the backend owns the cap (`MAX_TTS_CHARS` in
 * `src-tauri/src/config/defaults.rs`) so the limit lives in exactly one place,
 * at the boundary of the external Edge TTS service.
 */
const CODE_FENCE_RE = /```[\s\S]*?```/g;
const IMAGE_RE = /!\[[^\]]*]\([^)]*\)/g;
const INLINE_CODE_RE = /`([^`]*)`/g;
const LINK_RE = /\[([^\]]+)]\([^)]*\)/g;
const EMPHASIS_RE = /(\*\*|__|\*|~~|`)/g;
const HEADING_RE = /^\s{0,3}#{1,6}\s+/gm;
const BLOCKQUOTE_RE = /^\s{0,3}>\s?/gm;
const LIST_RE = /^\s*(?:[-*+]|\d+[.)])\s+/gm;
const PIPE_RE = /\|/g;
const WHITESPACE_RE = /\s+/g;

/**
 * Returns a flat, whitespace-collapsed sentence of the input markdown. The
 * result is always trimmed; an input with no speakable text (empty, or only
 * code/formatting) yields an empty string, which callers treat as "skip".
 */
export function ttsReadableText(markdown: string): string {
  return (
    markdown
      // Images before links: `![alt](url)` contains `[alt](url)`, so the image
      // must be dropped wholesale first or the link pass would keep the alt text.
      .replace(IMAGE_RE, ' ')
      // Multi-line code blocks are dropped wholesale (not speakable); inline
      // code keeps its content — "run `bun run dev`" should be read verbatim.
      .replace(CODE_FENCE_RE, ' ')
      .replace(INLINE_CODE_RE, (_match, code: string) => code)
      // Links read as their label; the URL is noise.
      .replace(LINK_RE, (_match, label: string) => label)
      .replace(EMPHASIS_RE, '')
      .replace(HEADING_RE, '')
      .replace(BLOCKQUOTE_RE, '')
      .replace(LIST_RE, '')
      .replace(PIPE_RE, ' ')
      .replace(WHITESPACE_RE, ' ')
      .trim()
  );
}
