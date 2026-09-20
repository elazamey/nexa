/** Explicit, read-only arXiv metadata retrieval. No PDFs, code execution or training. */
import { requireCondition } from '../packages/cells/celia/learning/src/data.js';
const LIMIT = 256 * 1024;
function text(xml, tag, max) {
  const match = xml.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`));
  requireCondition(match, 'INVALID_ARXIV_ENTRY');
  const value = match[1].replace(/&#(x[0-9a-f]+|[0-9]+);/gi, (_, code) => {
    const point = code[0].toLowerCase() === 'x' ? parseInt(code.slice(1), 16) : Number(code);
    requireCondition(point >= 32 && point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff), 'INVALID_XML_ENTITY');
    return String.fromCodePoint(point);
  }).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
  requireCondition(value.length > 0 && value.length <= max, 'ARXIV_FIELD_LIMIT');
  return value;
}
export function parseArxivFeed(xml) {
  requireCondition(typeof xml === 'string' && Buffer.byteLength(xml) <= LIMIT && !/<!DOCTYPE|<!ENTITY|<!\[CDATA\[/i.test(xml), 'UNSAFE_OR_OVERSIZED_XML');
  requireCondition(/<feed\b[^>]*xmlns="http:\/\/www.w3.org\/2005\/Atom"/.test(xml) && /<\/feed>\s*$/.test(xml), 'INVALID_ARXIV_FEED');
  const entries = [...xml.matchAll(/<entry\b[^>]*>([\s\S]*?)<\/entry>/g)];
  requireCondition(entries.length <= 10, 'RESEARCH_RESULT_LIMIT');
  const ids = new Set();
  return entries.map(([, entry]) => {
    const sourceId = text(entry, 'id', 200);
    const match = sourceId.match(/^https?:\/\/arxiv\.org\/abs\/(\d{4}\.\d{4,5}(?:v\d+)?)$/);
    requireCondition(match && !ids.has(match[1]), 'UNTRUSTED_PAPER_URL');
    const id = match[1]; ids.add(id);
    const published = text(entry, 'published', 40);
    requireCondition(Number.isFinite(Date.parse(published)), 'INVALID_PUBLICATION_DATE');
    return { id, title: text(entry, 'title', 1000), abstract: text(entry, 'summary', 20000), published, url: `https://arxiv.org/abs/${id}`, untrusted: true };
  });
}
export async function fetchResearch(query, { fetchImpl = fetch } = {}) {
  requireCondition(typeof query === 'string' && query.trim().length >= 3 && query.length <= 120 && /^[\p{L}\p{N} -]+$/u.test(query), 'INVALID_RESEARCH_QUERY');
  const url = new URL('https://export.arxiv.org/api/query');
  url.search = new URLSearchParams({ search_query: `all:"${query.trim()}"`, start: '0', max_results: '5', sortBy: 'submittedDate', sortOrder: 'descending' }).toString();
  const response = await fetchImpl(url, { redirect: 'error', signal: AbortSignal.timeout(10000), headers: { Accept: 'application/atom+xml', 'User-Agent': 'Nexa-Research-Reader/0.1' } });
  requireCondition(response.ok && response.body && /(?:application\/(?:atom\+xml|xml)|text\/xml)/i.test(response.headers.get('content-type') ?? ''), 'RESEARCH_SOURCE_UNAVAILABLE');
  const reader = response.body.getReader();
  const chunks = []; let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      requireCondition(size <= LIMIT, 'RESEARCH_RESPONSE_LIMIT');
      chunks.push(Buffer.from(value));
    }
  } finally { await reader.cancel(); }
  return { source: 'arxiv', retrievedAt: new Date().toISOString(), query, purpose: 'HUMAN_REVIEW_ONLY', autoTraining: false, papers: parseArxivFeed(Buffer.concat(chunks).toString('utf8')) };
}
