"use client";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useERP } from "@/components/erp/context";
import { useUser } from "@/app/(dashboard)/user-context";
import { canAction } from "@/lib/types";
import {
  ArrowRight,
  Factory,
  FlaskConical,
  Warehouse,
  Handshake,
  Database,
  Settings2,
  LayoutDashboard,
  Inbox,
} from "lucide-react";
export function useWorkspaceGroups() {
  const erp = useERP(),
    { user } = useUser();
  return [
    {
      name: "Overview",
      description: "Your day, priorities and performance",
      icon: LayoutDashboard,
      links: [
        ["Home", "/dashboard"],
        ["Inbox", "/dashboard/inbox"],
      ],
    },
    ...(erp.can("production")
      ? [
          {
            name: "Production",
            description: "Record finished batches",
            icon: Factory,
            links: [["Production records", "/dashboard/production"]],
          },
        ]
      : []),
    ...(erp.can("quality")
      ? [
          {
            name: "Quality",
            description: "Inspections and certificates",
            icon: FlaskConical,
            links: [
              ["Inspections", "/dashboard/inspeksi"],
              ["Certificates", "/dashboard/coa"],
              ["Documents", "/dashboard/arsip"],
              ["Quality analytics", "/dashboard/quality"],
            ],
          },
        ]
      : []),
    ...(erp.can("warehouse")
      ? [
          {
            name: "Warehouse",
            description: "Stock, traceability and dispatch",
            icon: Warehouse,
            links: [
              ["Stock", "/dashboard/warehouse?view=stock"],
              ["Movements", "/dashboard/warehouse?view=movements"],
              ["Stock counts", "/dashboard/warehouse?view=counts"],
              ["Lots & traceability", "/dashboard/warehouse?view=lots"],
              ["Dispatch", "/dashboard/warehouse?view=fulfillment"],
              ["Returns", "/dashboard/warehouse?view=returns"],
              ["Stock ledger", "/dashboard/warehouse?view=ledger"],
            ],
          },
        ]
      : []),
    ...(erp.can("sales")
      ? [
          {
            name: "Sales",
            description: "Quotations, orders and customers",
            icon: Handshake,
            links: [
              ["Quotations", "/dashboard/sales?view=quotes"],
              ["Sales orders", "/dashboard/sales?view=orders"],
              ["Customers", "/dashboard/sales?view=customers"],
            ],
          },
        ]
      : []),
    {
      name: "Master data",
      description: "Products, units and locations",
      icon: Database,
      links: [
        ["Products", "/dashboard/produk"],
        ...(erp.data?.admin
          ? [
              ["Product series", "/dashboard/settings?view=series"],
              ["Units & conversions", "/dashboard/settings?view=catalog"],
              ["Locations", "/dashboard/settings?view=locations"],
            ]
          : []),
      ],
    },
    ...(canAction(user?.role || "viewer", "manage_users")
      ? [
          {
            name: "Administration",
            description: "People, access and configuration",
            icon: Settings2,
            links: [
              ["Users", "/dashboard/pengguna"],
              ["Access", "/dashboard/settings?view=access"],
              ["Module settings", "/dashboard/settings?view=modules"],
              ["Audit log", "/dashboard/audit"],
            ],
          },
        ]
      : []),
  ];
}
export function WorkspaceDirectory() {
  const groups = useWorkspaceGroups();
  return (
    <div className="page-stack work-directory">
      <div>
        <p className="micro-label">WORKSPACE</p>
        <h1>Work</h1>
        <p>Choose where to work. Everything stays connected.</p>
      </div>
      {groups.map(({ name, description, icon: Icon, links }) => (
        <details key={name} className="work-group">
          <summary>
            <Icon />
            <span>
              <strong>{name}</strong>
              <small>{description}</small>
            </span>
            <ArrowRight />
          </summary>
          <nav aria-label={name}>
            {links.map(([label, href]) => (
              <Link key={href} href={href}>
                {label}
                <ArrowRight className="size-4" />
              </Link>
            ))}
          </nav>
        </details>
      ))}
    </div>
  );
}
export function WorkspaceSidebar({ collapsed }: { collapsed: boolean }) {
  const groups = useWorkspaceGroups(),
    path = usePathname(),
    params = useSearchParams();
  function active(href: string) {
    const [p, q] = href.split("?");
    return (
      path === p &&
      (!q ||
        new URLSearchParams(q).get("view") ===
          (params.get("view") ||
            (p.endsWith("warehouse")
              ? "stock"
              : p.endsWith("sales")
                ? "quotes"
                : "modules")))
    );
  }
  if (collapsed)
    return (
      <nav
        aria-label="Main navigation"
        className="workspace-sidebar-nav collapsed-navigation"
      >
        {groups.map(({ name, icon: Icon, links }) => (
          <Link href={links[0][1]} key={name} title={name} aria-label={name}>
            <Icon className="size-5" />
          </Link>
        ))}
      </nav>
    );
  return (
    <nav aria-label="Main navigation" className="workspace-sidebar-nav">
      {groups.map(({ name, icon: Icon, links }) => (
        <details
          key={name}
          open={collapsed || links.some(([, href]) => active(href))}
        >
          <summary title={name}>
            <Icon className="size-4" />
            <span>{name}</span>
          </summary>
          <div>
            {links.map(([label, href]) => (
              <Link
                title={label}
                key={href}
                href={href}
                aria-current={active(href) ? "page" : undefined}
              >
                {label}
              </Link>
            ))}
          </div>
        </details>
      ))}
      <Link className="sidebar-inbox" href="/dashboard/inbox">
        <Inbox className="size-4" />
        <span>Work inbox</span>
      </Link>
    </nav>
  );
}
