import { forwardRef, type ComponentPropsWithoutRef } from "react";

/**
 * Production-safe internal navigation.
 *
 * The current Vinext hosting runtime throws inside the Next Link click path.
 * Native anchors keep navigation dependable while preserving ordinary browser
 * behavior, keyboard access, and progressive enhancement.
 */
export const SiteLink = forwardRef<HTMLAnchorElement, ComponentPropsWithoutRef<"a">>(
  function SiteLink(props, ref) {
    return <a ref={ref} {...props} />;
  },
);

SiteLink.displayName = "SiteLink";
