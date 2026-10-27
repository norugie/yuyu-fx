import { useCallback, useState } from "react";

// Light / dark theme. Follows the system setting until the user picks one;
// the choice is remembered in this browser only.

export type ThemeChoice = "light" | "dark" | "system";

const STORAGE_KEY = "yuyufx-theme";
const darkQuery = () => window.matchMedia("(prefers-color-scheme: dark)");

function readChoice(): ThemeChoice {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    if (value === "light" || value === "dark") return value;
  } catch {
    // Storage blocked: fall back to the system setting.
  }
  return "system";
}

function apply(choice: ThemeChoice) {
  const dark = choice === "dark" || (choice === "system" && darkQuery().matches);
  document.documentElement.classList.toggle("dark", dark);
  document.documentElement.style.colorScheme = dark ? "dark" : "light";
}

/**
 * Call once before React renders: applies the saved theme (no flash) and keeps
 * following the system setting on every page, login included.
 */
export function initTheme() {
  apply(readChoice());
  darkQuery().addEventListener("change", () => {
    if (readChoice() === "system") apply("system");
  });
}

export function useTheme() {
  const [choice, setChoice] = useState<ThemeChoice>(readChoice);

  /** Flip between light and dark (from whatever is showing now). */
  const toggle = useCallback(() => {
    const next: ThemeChoice = document.documentElement.classList.contains("dark") ? "light" : "dark";
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Not remembered; still applied for this visit.
    }
    apply(next);
    setChoice(next);
  }, []);

  return { choice, toggle };
}
