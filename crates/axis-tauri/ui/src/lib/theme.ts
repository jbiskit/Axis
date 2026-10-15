import { useCallback, useEffect, useState } from "react";

export type Theme = "dark" | "light";

const THEME_KEY = "axis.theme";

export function loadTheme(): Theme {
  try {
    const stored = window.localStorage.getItem(THEME_KEY);
    if (stored === "light" || stored === "dark") return stored;
  } catch {
    /* ignore quota / private mode */
  }
  return "dark";
}

export function saveTheme(theme: Theme): void {
  try {
    window.localStorage.setItem(THEME_KEY, theme);
  } catch {
    /* ignore quota / private mode */
  }
}

/** Applies the theme by setting `data-theme` on <html>, which tokens.css keys off. */
export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
}

export function useTheme(): { theme: Theme; toggle: () => void } {
  const [theme, setTheme] = useState<Theme>(() => loadTheme());

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  const toggle = useCallback(() => {
    setTheme((current) => {
      const next: Theme = current === "dark" ? "light" : "dark";
      saveTheme(next);
      return next;
    });
  }, []);

  return { theme, toggle };
}

export type Density = "comfortable" | "compact";

const DENSITY_KEY = "axis.density";

export function loadDensity(): Density {
  try {
    if (window.localStorage.getItem(DENSITY_KEY) === "compact") return "compact";
  } catch {
    /* ignore quota / private mode */
  }
  return "comfortable";
}

function saveDensity(density: Density): void {
  try {
    window.localStorage.setItem(DENSITY_KEY, density);
  } catch {
    /* ignore quota / private mode */
  }
}

/** Applies density by setting `data-density` on <html>, which density.css keys off. */
export function applyDensity(density: Density): void {
  document.documentElement.dataset.density = density;
}

export function useDensity(): { density: Density; setDensity: (density: Density) => void } {
  const [density, setState] = useState<Density>(() => loadDensity());

  useEffect(() => {
    applyDensity(density);
  }, [density]);

  const setDensity = useCallback((next: Density) => {
    saveDensity(next);
    setState(next);
  }, []);

  return { density, setDensity };
}
