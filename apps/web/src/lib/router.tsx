import { useSyncExternalStore, type AnchorHTMLAttributes, type MouseEvent } from "react";

// A tiny client-side router: a handful of fixed pages doesn't need a routing library.

const NAVIGATE_EVENT = "yuyufx:navigate";

function subscribe(onChange: () => void) {
  window.addEventListener("popstate", onChange);
  window.addEventListener(NAVIGATE_EVENT, onChange);
  return () => {
    window.removeEventListener("popstate", onChange);
    window.removeEventListener(NAVIGATE_EVENT, onChange);
  };
}

/** The current URL path, re-rendering when it changes. */
export function usePath(): string {
  return useSyncExternalStore(subscribe, () => window.location.pathname);
}

export function navigate(path: string, { replace = false } = {}) {
  if (window.location.pathname === path) return;
  if (replace) window.history.replaceState(null, "", path);
  else window.history.pushState(null, "", path);
  window.dispatchEvent(new Event(NAVIGATE_EVENT));
}

type LinkProps = AnchorHTMLAttributes<HTMLAnchorElement> & { href: string };

/** A normal <a> (works with keyboard, middle-click, copy link) that navigates without reloading. */
export function Link({ href, onClick, ...props }: LinkProps) {
  function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    onClick?.(event);
    if (event.defaultPrevented || event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    navigate(href);
  }
  return <a href={href} onClick={handleClick} {...props} />;
}
