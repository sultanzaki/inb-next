"use client";

import { useState, type ReactNode } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import {
  Check,
  ChevronDown,
  ChevronsUpDown,
  Search,
  Menu,
  ArrowUpRight,
} from "lucide-react";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";
import { useWorkspaceGroups } from "./workspace-navigation";

type Destination = string[];
/** Mobile console navigation shares desktop permissions and keeps both levels explicit. */
export function MobileConsoleNavigation({
  onSearch,
  account,
}: {
  onSearch: () => void;
  account: ReactNode;
}) {
  const groups = useWorkspaceGroups(),
    path = usePathname(),
    params = useSearchParams();
  const [workspaceOpen, setWorkspaceOpen] = useState(false),
    [pagesOpen, setPagesOpen] = useState(false);
  const view =
    params.get("view") ||
    (path.endsWith("warehouse")
      ? "stock"
      : path.endsWith("sales")
        ? "quotes"
        : "modules");
  function active(href: string) {
    const [p, q] = href.split("?");
    return p === path && (!q || new URLSearchParams(q).get("view") === view);
  }
  const current =
    groups.find((g) => g.links.some(([, href]) => active(href))) ||
    (path.endsWith("settings") && view === "units"
      ? groups.find((g) => g.name === "Master data")
      : undefined) ||
    groups[0];
  const pages: Destination[] = current.links.flatMap(([label, href]) =>
    href.endsWith("?view=catalog")
      ? [
          ["Units", "/dashboard/settings?view=units"],
          ["Product conversions", href],
        ]
      : [[label, href]],
  );
  const page =
    pages.find(([, href]) => active(href))?.[0] ||
    (path.endsWith("/work") ? "Workspaces" : "Workspace");
  return (
    <nav className="mobile-console-header" aria-label="Mobile navigation">
      <div className="mobile-console-bar">
        <Link
          href="/dashboard"
          className="mobile-console-brand"
          aria-label="INBIONUSA home"
        >
          <Image src="/logo.png" alt="" width={28} height={28} priority />
        </Link>
        <span className="mobile-console-divider" aria-hidden="true">
          /
        </span>
        <Popover open={workspaceOpen} onOpenChange={setWorkspaceOpen}>
          <PopoverTrigger
            render={
              <button
                type="button"
                className="mobile-workspace-trigger"
                aria-label="Switch workspace"
              />
            }
          >
            <span>{current.name}</span>
            <ChevronsUpDown aria-hidden="true" />
          </PopoverTrigger>
          <PopoverContent
            collisionPadding={12}
            label="Workspaces"
            className="mobile-console-menu mobile-workspace-menu"
          >
            <p className="mobile-menu-caption">WORKSPACES</p>
            <div className="mobile-menu-scroll">
              {groups.map(({ name, icon: Icon, links }) => (
                <Link
                  key={name}
                  href={links[0][1]}
                  className="mobile-workspace-option"
                  aria-current={name === current.name ? "true" : undefined}
                  onClick={() => setWorkspaceOpen(false)}
                >
                  <span className="mobile-workspace-icon">
                    <Icon aria-hidden="true" />
                  </span>
                  <span>{name}</span>
                  {name === current.name && (
                    <Check className="mobile-menu-check" aria-hidden="true" />
                  )}
                </Link>
              ))}
            </div>
            <Link
              className="mobile-menu-footer"
              href="/dashboard/work"
              onClick={() => setWorkspaceOpen(false)}
            >
              All workspaces
              <ArrowUpRight aria-hidden="true" />
            </Link>
          </PopoverContent>
        </Popover>
        <div className="mobile-console-actions">
          <button
            type="button"
            className="mobile-console-icon"
            aria-label="Search"
            onClick={onSearch}
          >
            <Search aria-hidden="true" />
          </button>
          {account}
        </div>
      </div>
      <div className="mobile-console-location">
        <Popover open={pagesOpen} onOpenChange={setPagesOpen}>
          <PopoverTrigger
            render={
              <button
                type="button"
                className="mobile-page-trigger"
                aria-label="Choose page"
              />
            }
          >
            <Menu aria-hidden="true" />
            <span>{page}</span>
            <ChevronDown aria-hidden="true" />
          </PopoverTrigger>
          <PopoverContent
            collisionPadding={16}
            label="Workspace pages"
            className="mobile-console-menu mobile-page-menu"
          >
            <p className="mobile-menu-caption">{current.name}</p>
            <div className="mobile-menu-scroll">
              {pages.map(([label, href]) => (
                <Link
                  href={href}
                  key={href}
                  aria-current={active(href) ? "page" : undefined}
                  onClick={() => setPagesOpen(false)}
                >
                  <span>{label}</span>
                  {active(href) && (
                    <Check className="mobile-menu-check" aria-hidden="true" />
                  )}
                </Link>
              ))}
            </div>
          </PopoverContent>
        </Popover>
      </div>
    </nav>
  );
}
