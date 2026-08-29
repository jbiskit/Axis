import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export type DocumentTab = {
  id: string;
  title: string;
};

export type TabDropPlace = "before" | "after";

export function reorderOpenIds(
  ids: string[],
  fromId: string,
  toId: string,
  place: TabDropPlace,
): string[] {
  if (fromId === toId) return ids;
  const from = ids.indexOf(fromId);
  const to = ids.indexOf(toId);
  if (from < 0 || to < 0) return ids;
  const next = ids.filter((id) => id !== fromId);
  let insertAt = next.indexOf(toId);
  if (insertAt < 0) return ids;
  if (place === "after") insertAt += 1;
  next.splice(insertAt, 0, fromId);
  return next;
}

export function useDocumentTabs(
  activeId: string | null,
  titleFor: (id: string) => string,
  storageKey?: string,
) {
  const [openIds, setOpenIds] = useState<string[]>(() => {
    if (!storageKey || typeof window === "undefined") return [];
    try {
      const parsed = JSON.parse(window.sessionStorage.getItem(`${storageKey}:ids`) ?? "[]");
      return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [];
    } catch {
      return [];
    }
  });
  const [titles, setTitles] = useState<Record<string, string>>(() => {
    if (!storageKey || typeof window === "undefined") return {};
    try {
      const parsed = JSON.parse(window.sessionStorage.getItem(`${storageKey}:titles`) ?? "{}");
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  });
  const suppressReopenId = useRef<string | null>(null);

  useEffect(() => {
    if (!activeId) {
      suppressReopenId.current = null;
      return;
    }
    if (suppressReopenId.current === activeId) return;
    suppressReopenId.current = null;
    setOpenIds((ids) => (ids.includes(activeId) ? ids : [...ids, activeId]));
  }, [activeId]);

  useEffect(() => {
    if (!activeId) return;
    const title = titleFor(activeId);
    setTitles((current) =>
      current[activeId] === title ? current : { ...current, [activeId]: title },
    );
  }, [activeId, titleFor]);

  useEffect(() => {
    if (!storageKey) return;
    window.sessionStorage.setItem(`${storageKey}:ids`, JSON.stringify(openIds));
  }, [openIds, storageKey]);

  useEffect(() => {
    if (!storageKey) return;
    window.sessionStorage.setItem(`${storageKey}:titles`, JSON.stringify(titles));
  }, [storageKey, titles]);

  const close = useCallback((id: string): string | null => {
    let remaining: string[] = [];
    setOpenIds((ids) => {
      remaining = ids.filter((item) => item !== id);
      return remaining;
    });
    setTitles((current) => {
      if (!(id in current)) return current;
      const next = { ...current };
      delete next[id];
      return next;
    });
    if (id === activeId) suppressReopenId.current = id;
    if (id !== activeId) return activeId;
    return remaining[remaining.length - 1] ?? null;
  }, [activeId]);

  const reorder = useCallback((fromId: string, toId: string, place: TabDropPlace) => {
    setOpenIds((ids) => reorderOpenIds(ids, fromId, toId, place));
  }, []);

  const tabs: DocumentTab[] = useMemo(
    () => openIds.map((id) => ({ id, title: titles[id] ?? titleFor(id) })),
    [openIds, titleFor, titles],
  );

  return { tabs, close, reorder };
}
