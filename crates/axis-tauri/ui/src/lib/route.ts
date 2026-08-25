export type AppRoute = {
  pathname: string;
  search: URLSearchParams;
  href: string;
};

function normalizePath(pathname: string): string {
  if (!pathname || pathname === "/") return "/intune";
  return pathname.replace(/\/+$/, "") || "/intune";
}

export function parseHash(hash = window.location.hash): AppRoute {
  const raw = hash.replace(/^#/, "") || "/intune";
  const url = new URL(raw, "https://axis.local");
  const pathname = normalizePath(url.pathname);
  const search = url.searchParams;
  const query = search.toString();
  return {
    pathname,
    search,
    href: query ? `${pathname}?${query}` : pathname,
  };
}

export function navigate(href: string): void {
  const next = href.startsWith("#") ? href.slice(1) : href;
  if (window.location.hash === `#${next}`) {
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    return;
  }
  window.location.hash = next;
}

export function hrefWithParam(pathname: string, search: URLSearchParams, key: string, value: string | null): string {
  const next = new URLSearchParams(search);
  if (value) next.set(key, value);
  else next.delete(key);
  const query = next.toString();
  return query ? `${pathname}?${query}` : pathname;
}
