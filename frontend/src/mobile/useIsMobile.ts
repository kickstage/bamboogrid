import { useEffect, useState } from "react";

// A phone/tablet: a small viewport driven by a coarse (touch) pointer. A
// touch-capable laptop with a large screen stays on the full desktop editor.
const QUERY = "(max-width: 820px) and (pointer: coarse)";

export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== "undefined" && window.matchMedia(QUERY).matches,
  );

  useEffect(() => {
    const mql = window.matchMedia(QUERY);
    const onChange = () => setIsMobile(mql.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  return isMobile;
}
