/** Group long modules without hiding or duplicating any permitted destination. */
export function navigationSections(module: string, links: string[][]) {
  const categories: Record<string, Record<string, string>> = {
    Quality: {
      "Incoming inspections": "Inspections & release",
      Inspections: "Inspections & release",
      "Material lots & disposition": "Inspections & release",
      Certificates: "Inspections & release",
      Deviations: "Improvement",
      "CAPA actions": "Improvement",
      "Quality analytics": "Improvement",
    },
    Warehouse: {
      "Inventory by warehouse": "Inventory",
      Stock: "Inventory",
      "Material stock": "Inventory",
      "Lots & traceability": "Inventory",
      "Stock counts": "Inventory",
      "Pallet tracking": "Operations",
      "Warehouse transfers": "Operations",
      Movements: "Operations",
      Dispatch: "Operations",
      Returns: "Operations",
      "Stock ledger": "History",
      "Material ledger": "History",
      Warehouses: "Setup",
      "Storage locations": "Setup",
    },
  };
  if (links.length <= 6) return [{ name: "", links }];
  const grouped = new Map<string, string[][]>();
  for (const link of links) {
    const category =
      categories[module]?.[link[0]] ||
      (module === "Quality" ? "Standards & suppliers" : "More pages");
    grouped.set(category, [...(grouped.get(category) || []), link]);
  }
  // A catch-all alone does not improve navigation.
  return grouped.size > 1
    ? Array.from(grouped, ([name, links]) => ({ name, links }))
    : [{ name: "", links }];
}

export function workspaceLinkActive(
  href: string,
  path: string,
  view: string | null,
) {
  const [target, query] = href.split("?");
  if (target !== path) return false;
  const defaults: Record<string, string> = {
    "/dashboard/warehouse": "stock",
    "/dashboard/sales": "quotes",
    "/dashboard/finance": "documents",
    "/dashboard/service": "cases",
    "/dashboard/purchase": "purchases",
    "/dashboard/crm": "opportunities",
    "/dashboard/product-documents": "product_documents",
    "/dashboard/admin/settings": "modules",
  };
  const expected =
    new URLSearchParams(query).get("view") || defaults[target] || null;
  return expected === (view || defaults[path] || null);
}
