/** Role identifiers are persisted; labels can evolve without rewriting accounts. */
export const BUSINESS_ROLES = [
  "administrator inbionusa",
  "quality_manager",
  "quality_officer",
  "warehouse_manager",
  "warehouse_operator",
  "production_operator",
  "purchasing_manager",
  "purchasing_officer",
  "sales_manager",
  "sales_officer",
  "viewer",
  "admin qc",
  "qc supervisor",
] as const;
export const ROLE_LABELS: Record<string, string> = {
  "administrator inbionusa": "Administrator",
  "admin qc": "Administrator (legacy)",
  "qc supervisor": "Quality Supervisor (legacy)",
  quality_manager: "Quality Manager",
  quality_officer: "Quality Officer",
  warehouse_manager: "Warehouse Manager",
  warehouse_operator: "Warehouse Operator",
  production_operator: "Production Operator",
  purchasing_manager: "Purchasing Manager",
  purchasing_officer: "Purchasing Officer",
  sales_manager: "Sales Manager",
  sales_officer: "Sales Officer",
  viewer: "Viewer",
};
export const roleLabel = (role: string) => ROLE_LABELS[role] || "Unknown role";
