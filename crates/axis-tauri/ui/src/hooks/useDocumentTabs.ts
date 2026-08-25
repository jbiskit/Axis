import { useCallback, useEffect, useMemo, useState } from "react";

export type DocumentTab = {
  id: string;
  title: string;
};

export function useDocumentTabs(
  activeId: string | null,
  titleFor: (id: string) => string,
) {
  const [openIds, setOpenIds] = useState<string[]>([]);
  const [titles, setTitles] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!activeId) return;
    setOpenIds((ids) => (ids.includes(activeId) ? ids : [...ids, activeId]));
    const title = titleFor(activeId);
    setTitles((current) =>
      current[activeId] === title ? current : { ...current, [activeId]: title },
    );
  }, [activeId, titleFor]);

  const close = useCallback(
    (id: string): string | null => {
      const remaining = openIds.filter((item) => item !== id);
      setOpenIds(remaining);
      setTitles((current) => {
        const next = { ...current };
        delete next[id];
        return next;
      });
      if (id !== activeId) return activeId;
      return remaining[remaining.length - 1] ?? null;
    },
    [activeId, openIds],
  );

  const tabs: DocumentTab[] = useMemo(
    () => openIds.map((id) => ({ id, title: titles[id] ?? titleFor(id) })),
    [openIds, titleFor, titles],
  );

  return { tabs, close };
}
