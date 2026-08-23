"use client";

import { useEffect } from "react";

/* Radix popovers (Select, DropdownMenu, Tooltip, Sheet) portal to
   document.body, outside the layout's .dark wrapper div — so they would pick
   up the :root light tokens. Restore .dark on <html> while the dashboard
   route is mounted; the wrapper div still covers the pre-hydration paint. */
export default function ThemeClass() {
  useEffect(() => {
    document.documentElement.classList.add("dark");
    return () => document.documentElement.classList.remove("dark");
  }, []);
  return null;
}
