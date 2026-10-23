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
  ShoppingCart,
  ContactRound,
  Files,
  WalletCards,
  LifeBuoy,
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
            description: "Formulas, material usage and finished batches",
            icon: Factory,
            links: [
              ["Production orders", "/dashboard/production/orders"],
              ["Formulas & BOM", "/dashboard/production/formulas"],
              ["Production records", "/dashboard/production"],
            ],
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
              ["Inspections", "/dashboard/quality/inspections"],
              [
                "Incoming inspections",
                "/dashboard/quality/incoming-inspections",
              ],
              [
                "Material lots & disposition",
                "/dashboard/quality/material-lots",
              ],
              [
                "Material specifications",
                "/dashboard/quality/material-specifications",
              ],
              [
                "Material release policies",
                "/dashboard/quality/material-policies",
              ],
              ["Approved suppliers", "/dashboard/quality/approved-suppliers"],
              ["Deviations", "/dashboard/quality/deviations"],
              ["CAPA actions", "/dashboard/quality/capa"],
              ["Certificates", "/dashboard/quality/certificates"],
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
              ["Inventory by warehouse", "/dashboard/warehouse/inventory"],
              ["Pallet tracking", "/dashboard/warehouse/pallets"],
              ["Warehouse transfers", "/dashboard/warehouse/transfers"],
              ["Warehouses", "/dashboard/warehouse/sites"],
              ["Storage locations", "/dashboard/warehouse/locations"],
              ["Stock", "/dashboard/warehouse?view=stock"],
              ["Movements", "/dashboard/warehouse?view=movements"],
              ["Stock counts", "/dashboard/warehouse?view=counts"],
              ["Lots & traceability", "/dashboard/warehouse?view=lots"],
              ["Dispatch", "/dashboard/warehouse?view=fulfillment"],
              ["Returns", "/dashboard/warehouse?view=returns"],
              ["Stock ledger", "/dashboard/warehouse?view=ledger"],
              ["Material stock", "/dashboard/warehouse/material-inventory"],
              [
                "Material ledger",
                "/dashboard/warehouse/materials?view=material_ledger",
              ],
            ],
          },
        ]
      : []),
    ...(erp.can("purchase")
      ? [
          {
            name: "Purchase",
            description: "Suppliers and raw material purchasing",
            icon: ShoppingCart,
            links: [
              ["Purchase orders", "/dashboard/purchase?view=purchases"],
              ["Suppliers", "/dashboard/purchase?view=suppliers"],
              ["Raw materials", "/dashboard/purchase?view=materials"],
            ],
          },
        ]
      : []),
    ...(erp.can("finance")
      ? [
          {
            name: "Finance",
            description: "Billing, payments and credit control",
            icon: WalletCards,
            links: [
              ["Invoices & billing", "/dashboard/finance"],
              ["Payments", "/dashboard/finance?view=payments"],
              ["Dispatch clearance", "/dashboard/finance?view=orders"],
              ["Purchase matching", "/dashboard/finance?view=purchases"],
              ["Customer credit", "/dashboard/finance?view=credit_policies"],
              ["AR / AP aging", "/dashboard/finance?view=aging"],
            ],
          },
        ]
      : []),
    ...(erp.can("service")
      ? [
          {
            name: "Service & exceptions",
            description: "Claims, receipt evidence and resolution",
            icon: LifeBuoy,
            links: [
              ["Cases", "/dashboard/service"],
              ["Customer receipts", "/dashboard/service?view=receipts"],
              ["Material holds", "/dashboard/service?view=material_stock"],
              ...(erp.data?.admin
                ? [["Operating policy", "/dashboard/service?view=policy"]]
                : []),
            ],
          },
        ]
      : []),
    ...(erp.can("crm")
      ? [
          {
            name: "CRM",
            description: "Opportunities and follow-up",
            icon: ContactRound,
            links: [
              ["Pipeline", "/dashboard/crm?view=opportunities"],
              ["Activities", "/dashboard/crm?view=crm_activities"],
              ["Customer samples", "/dashboard/crm/samples"],
              ["Customer interactions", "/dashboard/crm/interactions"],
              ["Document distribution", "/dashboard/crm/documents"],
            ],
          },
        ]
      : []),
    ...(erp.can("documents")
      ? [
          {
            name: "Product documents",
            description: "SDS, TDS and controlled revisions",
            icon: Files,
            links: [
              ["Product documents", "/dashboard/product-documents"],
              [
                "Material & supplier documents",
                "/dashboard/product-documents/materials",
              ],
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
        ["Products", "/dashboard/master-data/products"],
        ...(erp.data?.admin
          ? [
              ["Product series", "/dashboard/admin/settings?view=series"],
              ["Units & conversions", "/dashboard/admin/settings?view=catalog"],
              ["Locations", "/dashboard/admin/settings?view=locations"],
            ]
          : []),
      ],
    },
    ...(canAction(user || "viewer", "manage_users")
      ? [
          {
            name: "Administration",
            description: "People, access and configuration",
            icon: Settings2,
            links: [
              ["Users", "/dashboard/admin/users"],
              ["Access", "/dashboard/admin/settings?view=access"],
              [
                "Warehouse access",
                "/dashboard/admin/settings/warehouse-access",
              ],
              ["Module settings", "/dashboard/admin/settings?view=modules"],
              ["Audit log", "/dashboard/admin/audit-log"],
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
        <h1>All workspaces</h1>
        <p>Choose where to work. Everything stays connected.</p>
      </div>
      <nav className="workspace-launcher" aria-label="All workspaces">
        {groups.map(({ name, description, icon: Icon, links }) => (
          <Link key={name} href={links[0][1]} className="workspace-tile">
            <span className="workspace-tile-icon">
              <Icon aria-hidden="true" />
            </span>
            <strong>{name}</strong>
            <span className="workspace-tile-description">{description}</span>
            <ArrowRight className="workspace-tile-arrow" aria-hidden="true" />
          </Link>
        ))}
      </nav>
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
