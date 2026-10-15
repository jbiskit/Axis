import type { NavItem } from "../types/inventory";
import { ALL_NAV, flattenNav } from "./nav";

/** A single global-search hit: a tenant object or a navigation destination. */
export type GlobalSearchHit = {
  id: string;
  /** Grouping label, e.g. "Devices", "Policies", "Navigate". */
  group: string;
  title: string;
  /** Secondary line — platform, publisher, state, etc. */
  meta?: string | null;
  /** Where selecting the hit navigates. */
  href: string;
};

/** Minimal shape every searchable inventory row must expose. */
export type SearchableRow = {
  id: string;
  title: string;
  meta?: string | null;
};

export type SearchSource = {
  group: string;
  /** Builds the destination for a row id. */
  href: (id: string) => string;
  rows: SearchableRow[];
  /**
   * Extra `key:value` tokens this source matches, e.g. `["type:policy"]`.
   * A row matches when every token in the query is found in its own tokens.
   */
  tokens?: string[];
};

const MAX_PER_GROUP = 6;

/** `key:value` tokens a source can be filtered by. */
export type SearchToken = { key: string; value: string };

/** Splits a query into `key:value` filters and free text. */
export function parseSearchQuery(query: string): { tokens: SearchToken[]; text: string } {
  const tokens: SearchToken[] = [];
  const words: string[] = [];
  for (const part of query.trim().split(/\s+/)) {
    const separator = part.indexOf(":");
    if (separator > 0 && separator < part.length - 1) {
      tokens.push({
        key: part.slice(0, separator).toLowerCase(),
        value: part.slice(separator + 1).toLowerCase(),
      });
    } else if (part) {
      words.push(part);
    }
  }
  return { tokens, text: words.join(" ").toLowerCase() };
}

function matches(needle: string, ...fields: Array<string | null | undefined>): boolean {
  return fields.some((field) => field?.toLowerCase().includes(needle));
}

function tokenMatches(token: SearchToken, sourceTokens: string[]): boolean {
  return sourceTokens.some((candidate) => {
    const separator = candidate.indexOf(":");
    if (separator <= 0) return false;
    const key = candidate.slice(0, separator).toLowerCase();
    const value = candidate.slice(separator + 1).toLowerCase();
    return key === token.key && value.includes(token.value);
  });
}

/**
 * Search tenant objects and navigation destinations. Individual Settings
 * Catalog settings are intentionally excluded — only the objects that hold
 * them are searchable.
 *
 * Supports `key:value` filters, e.g. `type:compliance`, `type:policy`,
 * `type:device`, `type:app`, `type:script`, `type:profile`, `type:update`.
 * A source matches a filter when it declares a matching token.
 */
export function globalSearch(
  query: string,
  sources: SearchSource[],
  nav: NavItem[] = ALL_NAV,
): GlobalSearchHit[] {
  const { tokens, text } = parseSearchQuery(query);
  if (!text && tokens.length === 0) return [];
  if (!text && tokens.length > 0 && text.length < 2 && tokens.every((token) => !token.value)) {
    return [];
  }

  const hits: GlobalSearchHit[] = [];
  for (const source of sources) {
    const sourceTokens = source.tokens ?? [];
    if (!tokens.every((token) => tokenMatches(token, sourceTokens))) continue;
    let taken = 0;
    for (const row of source.rows) {
      if (taken >= MAX_PER_GROUP) break;
      if (text && !matches(text, row.title, row.meta)) continue;
      hits.push({
        id: `${source.group}:${row.id}`,
        group: source.group,
        title: row.title,
        meta: row.meta ?? null,
        href: source.href(row.id),
      });
      taken += 1;
    }
  }

  // Navigation only answers free text; a `type:` filter is about tenant objects.
  if (text && tokens.length === 0) {
    let navTaken = 0;
    for (const item of flattenNav(nav)) {
      if (navTaken >= MAX_PER_GROUP) break;
      if (item.status === "planned") continue;
      if (!matches(text, item.label, item.section)) continue;
      hits.push({
        id: `nav:${item.href}`,
        group: "Navigate",
        title: item.label,
        meta: item.section ?? null,
        href: item.href,
      });
      navTaken += 1;
    }
  }

  return hits;
}

/** Groups hits for rendering, preserving source order. */
export function groupHits(hits: GlobalSearchHit[]): Array<{ group: string; hits: GlobalSearchHit[] }> {
  const order: string[] = [];
  const byGroup = new Map<string, GlobalSearchHit[]>();
  for (const hit of hits) {
    if (!byGroup.has(hit.group)) {
      byGroup.set(hit.group, []);
      order.push(hit.group);
    }
    byGroup.get(hit.group)!.push(hit);
  }
  return order.map((group) => ({ group, hits: byGroup.get(group)! }));
}
