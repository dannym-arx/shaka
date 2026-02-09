/**
 * Memory search: case-insensitive substring matching across session summaries.
 *
 * Searches file content (title, body, tags) and returns matches
 * sorted by date (most recent first) with context snippets.
 */

import { readdir } from "node:fs/promises";
import { parseSummaryOutput } from "./summarize";

const MAX_RESULTS = 10;
const SNIPPET_LENGTH = 200;

export interface SearchResult {
  readonly filePath: string;
  readonly title: string;
  readonly date: string;
  readonly tags: string[];
  readonly snippet: string;
}

/**
 * Search session summaries for a query string.
 *
 * Performs case-insensitive substring matching across file content
 * (title, body, tags). Returns up to 10 results sorted by date
 * (most recent first), each with a ~200 char context snippet.
 */
export async function searchMemory(query: string, memoryDir: string): Promise<SearchResult[]> {
  const sessionsDir = `${memoryDir}/sessions`;
  const queryLower = query.toLowerCase();

  let entries: string[];
  try {
    entries = await readdir(sessionsDir);
  } catch {
    return [];
  }

  const results: SearchResult[] = [];

  for (const entry of entries) {
    if (!entry.endsWith(".md")) continue;

    const filePath = `${sessionsDir}/${entry}`;
    const file = Bun.file(filePath);

    let content: string;
    try {
      content = await file.text();
    } catch {
      continue;
    }

    if (!content.toLowerCase().includes(queryLower)) continue;

    const summary = parseSummaryOutput(content);
    if (!summary) continue;

    const snippet = extractSnippet(content, queryLower);

    results.push({
      filePath,
      title: summary.title,
      date: summary.metadata.date,
      tags: summary.tags,
      snippet,
    });
  }

  results.sort((a, b) => b.date.localeCompare(a.date));
  return results.slice(0, MAX_RESULTS);
}

/**
 * Extract a snippet of ~200 chars centered around the first occurrence
 * of the query in the content.
 */
function extractSnippet(content: string, queryLower: string): string {
  const lowerContent = content.toLowerCase();
  const matchIndex = lowerContent.indexOf(queryLower);

  if (matchIndex === -1) return content.slice(0, SNIPPET_LENGTH);

  const halfWindow = Math.floor(SNIPPET_LENGTH / 2);
  const start = Math.max(0, matchIndex - halfWindow);
  const end = Math.min(content.length, matchIndex + queryLower.length + halfWindow);

  let snippet = content.slice(start, end).trim();

  if (start > 0) snippet = `...${snippet}`;
  if (end < content.length) snippet = `${snippet}...`;

  return snippet;
}
