import { useEffect, useState } from "react";
import { parseHash, type AppRoute } from "../lib/route";

export function useHashRoute(): AppRoute {
  const [route, setRoute] = useState<AppRoute>(() =>
    typeof window === "undefined" ? parseHash("#/intune") : parseHash(),
  );

  useEffect(() => {
    if (!window.location.hash) {
      window.location.hash = "/intune";
    }
    const onChange = () => setRoute(parseHash());
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);

  return route;
}
