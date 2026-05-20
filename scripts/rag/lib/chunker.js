// scripts/rag/lib/chunker.js
// Paragraph-aware chunker. Walks paragraphs, greedy-packs them into chunks
// of ~MIN..MAX words. Headings stick to the section beneath them. Oversized
// paragraphs fall back to sentence-level splits.
'use strict';

const { normaliseText, wordCount } = require('./util');

const TARGET_MIN_WORDS = 200;
const TARGET_MAX_WORDS = 400;

/**
 * Split a markdown document into chunks.
 *
 * @param {string} markdown - raw .md content
 * @param {object} opts
 * @param {string} opts.sourcePath - relative path of the source file
 *                                   (carried into each chunk's metadata)
 * @returns {Array<{text: string, sourcePath: string, headingPath: string[]}>}
 */
function chunkMarkdown(markdown, { sourcePath }) {
  const normalised = normaliseText(markdown);

  // Split on blank lines. A paragraph is anything between blanks — that
  // includes single-line headings, list blocks, and prose.
  const paragraphs = normalised
    .split(/\n{2,}/)
    .map(p => p.trim())
    .filter(Boolean);

  const chunks = [];
  let buffer = [];
  let bufferWords = 0;
  let headingStack = []; // tracks H1/H2/H3 nesting for `headingPath`

  const flush = () => {
    if (!buffer.length) return;
    const text = buffer.join('\n\n').trim();
    if (text) {
      chunks.push({
        text,
        sourcePath,
        headingPath: [...headingStack],
      });
    }
    buffer = [];
    bufferWords = 0;
  };

  for (const para of paragraphs) {
    // Update the heading stack but don't emit headings on their own —
    // they ride along with the following paragraph.
    const headingMatch = para.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const title = headingMatch[2].trim();
      // Drop deeper levels, then push current.
      headingStack = headingStack.slice(0, level - 1);
      headingStack[level - 1] = title;
      // Heading itself is small — include it in the buffer so retrieved
      // chunks have section context. Don't count it toward the budget.
      buffer.push(para);
      continue;
    }

    const paraWords = wordCount(para);

    // Oversized paragraph: flush what we have, then sentence-split this one.
    if (paraWords > TARGET_MAX_WORDS) {
      flush();
      for (const sentenceChunk of splitOversizedParagraph(para)) {
        chunks.push({
          text: sentenceChunk,
          sourcePath,
          headingPath: [...headingStack],
        });
      }
      continue;
    }

    // Adding this para would blow past MAX — flush first, unless we're
    // still below MIN (in which case we keep packing to avoid tiny chunks).
    if (bufferWords + paraWords > TARGET_MAX_WORDS && bufferWords >= TARGET_MIN_WORDS) {
      flush();
    }

    buffer.push(para);
    bufferWords += paraWords;

    // Comfortable mid-range: emit and start a new chunk.
    if (bufferWords >= TARGET_MIN_WORDS && bufferWords <= TARGET_MAX_WORDS) {
      // Heuristic: only flush on paragraph boundary if we're at least at
      // the midpoint, otherwise let the next paragraph join us.
      if (bufferWords >= (TARGET_MIN_WORDS + TARGET_MAX_WORDS) / 2) {
        flush();
      }
    }
  }

  flush();
  return chunks;
}

/**
 * Sentence-split a single oversized paragraph into ~TARGET_MAX-word groups.
 * Naive splitter — fine for prose, would need work for code-heavy docs.
 */
function splitOversizedParagraph(paragraph) {
  const sentences = paragraph
    .split(/(?<=[.!?])\s+(?=[A-Z"'‘“])/)
    .filter(Boolean);

  const out = [];
  let buf = [];
  let words = 0;
  for (const s of sentences) {
    const w = wordCount(s);
    if (words + w > TARGET_MAX_WORDS && buf.length) {
      out.push(buf.join(' '));
      buf = [];
      words = 0;
    }
    buf.push(s);
    words += w;
  }
  if (buf.length) out.push(buf.join(' '));
  return out;
}

module.exports = { chunkMarkdown, TARGET_MIN_WORDS, TARGET_MAX_WORDS };
