"use client";
import { useId, useRef, type CSSProperties } from "react";
import Link from "next/link";
import {
  Grid2X2,
  ChevronDown,
  Search,
  Check,
  ArrowUpRight,
  type LucideIcon,
} from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
export type WorkspaceNavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  permission?: string;
};
const descriptions: Record<string, string> = {
  Warehouse: "Stock & counts",
  Production: "Finished goods",
  Sales: "Quotes & orders",
  Settings: "Modules & access",
  Dashboard: "At a glance",
  Products: "Standards & versions",
  Inspections: "Record & review",
  COA: "Issue & download",
  Documents: "Files & expiry",
  Users: "Accounts & access",
  Audit: "Activity & changes",
};
export function MobileNavigation({
  items,
  pathname,
  open,
  onOpenChange,
  onSearch,
}: {
  items: WorkspaceNavItem[];
  pathname: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSearch: () => void;
}) {
  const current = items.find((n) => n.href === pathname) || items[0],
    id = useId(),
    trigger = useRef<HTMLButtonElement>(null),
    launcher = useRef<HTMLDivElement>(null);
  const searchRequested = useRef(false);
  const CurrentIcon = current?.icon || Grid2X2;
  return (
    <>
      <button
        ref={trigger}
        className="mobile-space-switcher"
        type="button"
        aria-label="Open navigation menu"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => onOpenChange(!open)}
      >
        <span className="space-switcher-icon">
          <CurrentIcon className="size-4" />
        </span>
        <span>{current?.label || "Workspace"}</span>
        <ChevronDown className="space-switcher-chevron size-3.5" />
      </button>
      <Sheet
        open={open}
        onOpenChange={onOpenChange}
        onOpenChangeComplete={(isOpen) => {
          if (!isOpen && searchRequested.current) {
            searchRequested.current = false;
            onSearch();
          }
        }}
      >
        <SheetContent
          id={id}
          ref={launcher}
          initialFocus={launcher}
          finalFocus={trigger}
          side="top"
          className="workspace-launcher"
        >
          <SheetHeader>
            <div className="launcher-eyebrow">
              <span className="launcher-grid-mark" aria-hidden="true">
                <i />
                <i />
                <i />
                <i />
              </span>
              INBIONUSA / QC
            </div>
            <SheetTitle>Your workspace</SheetTitle>
            <SheetDescription>
              Choose a workspace or jump to a record.
            </SheetDescription>
          </SheetHeader>
          <button
            type="button"
            className="launcher-search"
            onClick={() => {
              searchRequested.current = true;
              onOpenChange(false);
            }}
          >
            <Search className="size-4" />
            <span>Find a lot, product, or COA</span>
            <ArrowUpRight className="size-4" />
          </button>
          <nav aria-label="Main navigation" className="launcher-grid">
            {items.map(({ icon: Icon, ...n }, index) => {
              const active = pathname === n.href,
                wide =
                  active ||
                  (items.length % 3 === 1 &&
                    (current?.href === items.at(-1)?.href
                      ? index === 0
                      : index === items.length - 1));
              return (
                <Link
                  href={n.href}
                  key={n.href}
                  aria-label={n.label}
                  aria-current={active ? "page" : undefined}
                  data-wide={wide}
                  className="launcher-tile"
                  style={{ "--tile-index": index } as CSSProperties}
                  transitionTypes={["workspace-navigation"]}
                  onClick={() => onOpenChange(false)}
                >
                  <span className="launcher-tile-icon">
                    <Icon className="size-5" />
                  </span>
                  <span className="launcher-tile-copy">
                    <span className="launcher-tile-label">{n.label}</span>
                    <span className="launcher-tile-description">
                      {descriptions[n.label]}
                    </span>
                  </span>
                  {active ? (
                    <Check className="launcher-tile-status size-3.5" />
                  ) : (
                    <span className="launcher-tile-number" aria-hidden="true">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                  )}
                </Link>
              );
            })}
          </nav>
          <div className="launcher-footer">
            <span className="launcher-location-dot" />
            <span>
              Currently in <strong>{current?.label}</strong>
            </span>
            <span className="launcher-footer-mark" aria-hidden="true">
              ↗
            </span>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
