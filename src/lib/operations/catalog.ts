import type { ModuleKey } from "../erp/schema";
export type WorkRow = Record<string, unknown> & {
  id: string;
  version?: number;
  state?: string;
  label?: string;
};
export type WorkField = {
  key: string;
  label: string;
  kind?:
    | "text"
    | "textarea"
    | "date"
    | "number"
    | "raw"
    | "boolean"
    | "select"
    | "ref"
    | "lines"
    | "results";
  required?: boolean;
  options?: string[];
  ref?: string;
  local?: string;
  pick?: string;
  scope?: Record<string, string>;
  fields?: WorkField[];
  hint?: string;
  default?: string | boolean;
};
export type WorkCommand = {
  label: string;
  help: string;
  module: ModuleKey;
  verb?: "write" | "approve";
  confirm?: boolean;
  fields: WorkField[];
  requires?: { module: ModuleKey; verb: "read" | "write" | "approve" }[];
  targetField?: string;
  targetFrom?: string;
  states?: string[];
};
export type WorkCollection = {
  title: string;
  singular: string;
  module: ModuleKey;
  description: string;
  create?: string;
  actions?: string[];
  columns: {
    key: string;
    label: string;
    type?: "text" | "number" | "date" | "boolean";
    hidden?: boolean;
  }[];
};
const text = (key: string, label: string, required = true): WorkField => ({
  key,
  label,
  required,
});
const num = (key: string, label: string, required = true): WorkField => ({
  key,
  label,
  kind: "number",
  required,
});
const date = (key: string, label: string, required = true): WorkField => ({
  key,
  label,
  kind: "date",
  required,
});
const ref = (
  key: string,
  label: string,
  source: string,
  required = true,
  scope?: Record<string, string>,
): WorkField => ({ key, label, kind: "ref", ref: source, required, scope });
const select = (
  key: string,
  label: string,
  options: string[],
  value?: string,
): WorkField => ({
  key,
  label,
  kind: "select",
  options,
  required: true,
  default: value || options[0],
});
const area = (key: string, label: string, required = true): WorkField => ({
  key,
  label,
  kind: "textarea",
  required,
});
const reason = area("reason", "Reason");
const bool = (key: string, label: string, value = false): WorkField => ({
  key,
  label,
  kind: "boolean",
  default: value,
});
const lines = (key: string, label: string, fields: WorkField[]): WorkField => ({
  key,
  label,
  kind: "lines",
  fields,
  required: true,
});
const local = (key: string, label: string, list: string): WorkField => ({
  key,
  label,
  kind: "ref",
  local: list,
  required: true,
});
const approve = (
  label: string,
  module: ModuleKey,
  states: string[],
): WorkCommand => ({
  label,
  help: "Review the current record before confirming. This action is recorded in its history.",
  module,
  verb: "approve",
  confirm: true,
  states,
  fields: [reason],
});
const c = (
  key: string,
  label: string,
  type?: "number" | "date" | "boolean",
) => ({ key, label, type });
const identity = [c("label", "Reference"), c("state", "Status")];
export const workCommands: Record<string, WorkCommand> = {
  save_warehouse: {
    label: "New warehouse",
    help: "Warehouses contain storage locations. Existing stock history stays linked to its original locations.",
    module: "warehouse",
    fields: [
      text("code", "Code"),
      text("name", "Warehouse name"),
      area("address", "Address", false),
      bool("active", "Active", true),
    ],
  },
  save_warehouse_location: {
    label: "Storage location",
    help: "Create a rack or bin inside an existing warehouse. Locations with stock history cannot be reassigned.",
    module: "warehouse",
    fields: [
      ref("warehouse_id", "Warehouse", "warehouses"),
      text("code", "Location code"),
      text("name", "Location name"),
      text("bin", "Rack / bin", false),
      bool("active", "Active", true),
    ],
  },
  set_warehouse_access: {
    label: "Warehouse access",
    help: "Restricted access limits this user to the warehouses listed below. Module permissions still apply; administrators retain full access.",
    module: "warehouse",
    confirm: true,
    fields: [
      ref("user_id", "User", "staff"),
      bool("restricted", "Restrict to assigned warehouses", true),
      {
        ...lines("warehouses", "Assigned warehouses", [
          ref("warehouse_id", "Warehouse", "warehouses"),
          bool("read", "Read", true),
          bool("write", "Operate"),
          bool("approve", "Approve"),
        ]),
        required: false,
      },
      reason,
    ],
  },
  save_formula: {
    label: "New formula",
    help: "Define material quantities for the stated output size. Every ingredient uses its own base stock unit. No stock changes when a formula is saved.",
    module: "production",
    fields: [
      text("title", "Formula name"),
      ref("product_id", "Finished product", "products"),
      ref("unit_id", "Output base unit", "units"),
      num("output_quantity", "Reference batch output"),
      date("effective_date", "Effective date"),
      lines("lines", "Materials and packaging", [
        ref("material_id", "Material", "materials"),
        num("quantity", "Quantity per reference batch"),
        select("role", "Usage", ["ingredient", "packaging"]),
        {
          ...num("tolerance_percent", "Allowed usage variance (%)"),
          default: "0",
        },
      ]),
      area("notes", "Notes", false),
    ],
  },
  revise_formula: approve("New formula revision", "production", [
    "approved",
    "superseded",
  ]),
  approve_formula: approve("Approve formula", "production", ["draft"]),
  withdraw_formula: approve("Withdraw formula", "production", [
    "draft",
    "approved",
  ]),
  create_manufacturing_order: {
    label: "New production order",
    help: "Requirements are scaled from the selected approved formula. Creating this order does not reserve or consume material stock.",
    module: "production",
    fields: [
      ref("formula_id", "Approved formula", "formulas", true, {
        state: "approved",
      }),
      num("target_quantity", "Planned output quantity"),
      date("planned_date", "Planned production date"),
      ref("location_id", "Finished goods destination", "locations"),
      ref("sales_order_id", "Sales order (optional)", "sales_orders", false, {
        state: "confirmed",
      }),
      area("notes", "Production notes", false),
    ],
  },
  release_manufacturing_order: approve("Release for production", "production", [
    "draft",
  ]),
  reserve_manufacturing_material: {
    label: "Reserve material",
    help: "Select the actual supplier lot and location. A reservation reduces available stock, but physical on-hand quantity is unchanged.",
    module: "production",
    confirm: true,
    states: ["released", "in_progress"],
    fields: [
      {
        ...local("material_id", "Planned material", "requirements"),
        pick: "material_id",
      },
      {
        ...ref(
          "lot_id",
          "Material lot and stock location",
          "material_inventory",
          true,
          { material_id: "$material_id" },
        ),
        pick: "lot_id",
      },
      ref("location_id", "Source location", "locations"),
      num("quantity", "Quantity to reserve"),
      area("reason", "Reason for additional allocation", false),
    ],
  },
  consume_material: {
    label: "Post actual material use",
    help: "Enter the weighed quantity actually used. Posting reduces stock once and records the operator and source lot. Unpack material first if it is still on a pallet.",
    module: "production",
    confirm: true,
    targetField: "reservation_id",
    states: ["released", "in_progress"],
    fields: [
      local("reservation_id", "Active reservation", "reservations"),
      num("quantity", "Actual weighed quantity"),
      reason,
    ],
  },
  release_material_reservation: {
    label: "Release unused reservation",
    help: "Release quantities no longer needed. This does not return material that has already been consumed.",
    module: "production",
    confirm: true,
    targetField: "reservation_id",
    states: ["released", "in_progress"],
    fields: [
      local("reservation_id", "Active reservation", "reservations"),
      reason,
    ],
  },
  return_manufacturing_material: {
    label: "Return unused material",
    help: "Select an actual consumption entry. Only its remaining unreturned quantity can be restored to the original lot and location.",
    module: "production",
    confirm: true,
    targetField: "input_id",
    states: ["released", "in_progress", "completed"],
    fields: [
      local("input_id", "Consumption to return", "inputs"),
      num("quantity", "Quantity returned"),
      reason,
    ],
  },
  record_manufacturing_output: {
    label: "Post finished output",
    help: "Creates an official batch identity and adds actual finished goods to quarantine. Incoming material usage must already be recorded.",
    module: "production",
    confirm: true,
    states: ["released", "in_progress"],
    fields: [
      num("quantity", "Actual finished output"),
      date("mfg_date", "Manufacturing date"),
      reason,
    ],
  },
  complete_manufacturing_order: {
    ...approve("Reconcile production", "production", [
      "released",
      "in_progress",
    ]),
    help: "Review actual material use, finished output and scrap. Release unused reservations. Variances beyond formula tolerance require an approved deviation.",
    fields: [
      {
        ...num("scrap_quantity", "Finished product scrap / loss"),
        default: "0",
      },
      reason,
    ],
  },
  close_manufacturing_order: approve("Close production order", "production", [
    "completed",
  ]),
  cancel_manufacturing_order: {
    ...approve("Cancel production order", "production", [
      "draft",
      "released",
      "in_progress",
    ]),
    help: "Cancellation requires no posted output and all consumed materials returned. History is retained.",
  },
  save_material_spec: {
    label: "New material specification",
    help: "Define a controlled incoming inspection standard. Numeric ranges and expected text results are evaluated by the server.",
    module: "quality",
    fields: [
      ref("material_id", "Material", "materials"),
      text("title", "Specification title"),
      date("effective_date", "Effective date"),
      lines("parameters", "Inspection parameters", [
        text("name", "Parameter"),
        select("kind", "Result type", ["range", "text"]),
        { ...text("minimum", "Minimum", false), kind: "raw" },
        { ...text("maximum", "Maximum", false), kind: "raw" },
        text("unit", "Unit", false),
        text("expected", "Expected text result", false),
      ]),
    ],
  },
  revise_material_spec: approve("New specification revision", "quality", [
    "approved",
    "superseded",
  ]),
  approve_material_spec: approve("Approve specification", "quality", ["draft"]),
  withdraw_material_spec: approve("Withdraw specification", "quality", [
    "draft",
    "approved",
  ]),
  set_material_quality_policy: {
    label: "Material release policy",
    help: "Enable incoming inspection and supplier qualification once standards are prepared. Historical lots keep their real recorded status; enabling QC may quarantine previously unassessed stock.",
    module: "quality",
    verb: "approve",
    confirm: true,
    fields: [
      bool("requires_qc", "Require incoming Quality release", true),
      bool("requires_approved_supplier", "Require an approved supplier", true),
      reason,
    ],
  },
  save_approved_supplier: {
    label: "Qualify a supplier",
    help: "Approval applies to one material / supplier combination and the dates below. Receiving goods does not automatically qualify their supplier.",
    module: "quality",
    fields: [
      ref("material_id", "Material", "materials"),
      ref("supplier_id", "Supplier", "suppliers"),
      date("effective_date", "Effective date"),
      date("expiry_date", "Expiry date", false),
      reason,
    ],
  },
  approve_supplier: approve("Approve supplier qualification", "quality", [
    "draft",
  ]),
  withdraw_supplier: approve("Withdraw supplier qualification", "quality", [
    "approved",
  ]),
  create_incoming_inspection: {
    label: "New incoming inspection",
    help: "Choose a physically received material lot. The current approved specification is captured as an immutable inspection snapshot.",
    module: "quality",
    fields: [ref("lot_id", "Received material lot", "material_lots")],
  },
  save_incoming_results: {
    label: "Enter inspection results",
    help: "Draft results do not release the material lot. Complete every parameter before finalization.",
    module: "quality",
    states: ["draft"],
    fields: [
      {
        key: "results",
        label: "Inspection results",
        kind: "results",
        required: true,
      },
      area("failure_reason", "Failure explanation", false),
    ],
  },
  finalize_incoming_inspection: {
    ...approve("Finalize inspection", "quality", ["draft"]),
    help: "The server evaluates PASS / FAIL. Failure requires an explanation. PASS cannot override a separate lot hold or supplier qualification requirements.",
    fields: [
      {
        key: "results",
        label: "Inspection results",
        kind: "results",
        required: true,
      },
      area("failure_reason", "Failure explanation", false),
      reason,
    ],
  },
  retest_incoming_inspection: {
    ...approve("Start controlled retest", "quality", ["pass", "fail"]),
    fields: [
      ref("deviation_id", "Approved deviation", "deviations", true, {
        state: "approved",
      }),
      reason,
    ],
  },
  save_deviation: {
    label: "New deviation",
    help: "Link at least one material lot, inspection or production order. Record what happened; investigation and disposition are reviewed separately.",
    module: "quality",
    fields: [
      text("title", "Deviation title"),
      area("description", "What happened"),
      ref("material_lot_id", "Material lot", "material_lots", false),
      ref(
        "manufacturing_order_id",
        "Production order",
        "manufacturing_orders",
        false,
      ),
      ref(
        "inspection_id",
        "Incoming inspection",
        "incoming_inspections",
        false,
      ),
      ref("assignee", "Owner", "staff", false),
      date("due_date", "Due date"),
      area("investigation", "Investigation", false),
      area("disposition", "Proposed disposition", false),
    ],
  },
  submit_deviation: approve("Submit investigation", "quality", [
    "open",
    "investigating",
  ]),
  approve_deviation: approve("Approve disposition", "quality", [
    "awaiting_approval",
  ]),
  close_deviation: approve("Close deviation", "quality", ["approved"]),
  save_capa: {
    label: "New CAPA action",
    help: "Define a corrective or preventive action, assign an owner and due date, then attach completion evidence for independent review.",
    module: "quality",
    fields: [
      ref("deviation_id", "Deviation", "deviations"),
      text("title", "Action title"),
      select("kind", "Action type", ["corrective", "preventive"]),
      area("action", "Action plan"),
      ref("assignee", "Owner", "staff"),
      date("due_date", "Due date"),
      area("evidence", "Completion evidence", false),
      area("effectiveness", "Effectiveness notes", false),
    ],
  },
  submit_capa: approve("Submit completion evidence", "quality", [
    "open",
    "in_progress",
  ]),
  verify_capa: {
    ...approve("Verify CAPA effectiveness", "quality", ["awaiting_review"]),
    fields: [area("effectiveness", "Effectiveness review"), reason],
  },
  save_controlled_document: {
    label: "New supplier / material document",
    help: "Link one material or one supplier. Use a version-specific HTTPS file URL. Published revisions cannot be overwritten.",
    module: "documents",
    fields: [
      ref("material_id", "Material", "materials", false),
      ref("supplier_id", "Supplier", "suppliers", false),
      text("title", "Document title"),
      select("kind", "Document type", [
        "SDS",
        "TDS",
        "COA",
        "HALAL",
        "ISO",
        "OTHER",
      ]),
      select("language", "Language", ["en", "id"]),
      text("file_url", "Version-specific file URL"),
      date("effective_date", "Effective date"),
      date("expiry_date", "Expiry date", false),
    ],
  },
  revise_controlled_document: approve("New document revision", "documents", [
    "published",
    "superseded",
  ]),
  publish_controlled_document: approve("Publish document", "documents", [
    "draft",
  ]),
  withdraw_controlled_document: approve("Withdraw document", "documents", [
    "draft",
    "published",
  ]),
  create_warehouse_transfer: {
    label: "New warehouse transfer",
    help: "Dispatch removes stock from the source and records it in transit. The destination receives only its actual confirmed quantities.",
    module: "warehouse",
    fields: [
      ref("from_location", "Source location", "locations"),
      ref("to_location", "Destination location", "transfer_destinations"),
      reason,
      {
        ...lines("lines", "Loose stock to transfer", [
          select("kind", "Stock type", ["material", "finished"]),
          {
            ...ref("lot_id", "Lot", "material_inventory", true, {
              location_id: "$from_location",
            }),
            pick: "lot_id",
          },
          num("quantity", "Quantity"),
        ]),
        required: false,
      },
      {
        key: "pallet_ids",
        label: "Packed pallets (optional)",
        kind: "lines",
        fields: [
          ref("id", "Pallet", "pallets", true, {
            state: "packed",
            location_id: "$from_location",
          }),
        ],
      },
    ],
  },
  dispatch_warehouse_transfer: {
    ...approve("Dispatch transfer", "warehouse", ["draft"]),
    verb: "write",
    help: "Stock leaves the source. Destination stock stays unchanged until receipt. Pallet manifests are checked against their current contents.",
  },
  receive_warehouse_transfer: {
    label: "Receive transfer",
    help: "Enter actual arriving quantities. Loose stock can arrive partially. A pallet receipt must account for its full manifest; shortages require approval and a reason.",
    module: "warehouse",
    confirm: true,
    states: ["in_transit", "partial"],
    fields: [
      {
        key: "lines",
        label: "Transfer receipt",
        kind: "lines",
        required: true,
        fields: [
          local("line_id", "Transfer line", "lines"),
          { ...num("quantity", "Actual received"), default: "0" },
          { ...num("lost_quantity", "Confirmed shortage"), default: "0" },
        ],
      },
      reason,
    ],
  },
  close_warehouse_transfer: approve("Close loose-stock shortage", "warehouse", [
    "in_transit",
    "partial",
  ]),
  cancel_warehouse_transfer: approve("Cancel transfer draft", "warehouse", [
    "draft",
  ]),
  create_pallet: {
    label: "New pallet",
    help: "A pallet is a traceable container, not a new stock receipt. Packing and unpacking do not change company stock.",
    module: "warehouse",
    fields: [
      ref("location_id", "Pallet location", "locations"),
      area("notes", "Notes", false),
    ],
  },
  pack_pallet: {
    label: "Pack stock onto pallet",
    help: "Choose stock already at this pallet location. The quantity cannot exceed stock that has not already been packed.",
    module: "warehouse",
    confirm: true,
    states: ["empty", "packed"],
    fields: [
      select("kind", "Stock type", ["material", "finished"]),
      {
        ...ref("lot_id", "Lot", "material_inventory", true, {
          location_id: "$location_id",
        }),
        pick: "lot_id",
      },
      num("quantity", "Quantity to pack"),
      reason,
    ],
  },
  unpack_pallet: {
    label: "Unpack pallet quantity",
    help: "Unpacking frees the container allocation but does not change total stock. Record a reason for repacking or loose issue.",
    module: "warehouse",
    confirm: true,
    states: ["packed"],
    fields: [
      local("content_id", "Packed lot", "contents"),
      num("quantity", "Quantity to unpack"),
      reason,
    ],
  },
  repack_pallet: {
    label: "Repack into another pallet",
    help: "Move a selected packed quantity into another pallet at the same location. Total stock stays unchanged; both pallet histories are preserved.",
    module: "warehouse",
    confirm: true,
    states: ["packed"],
    fields: [
      local("content_id", "Packed lot", "contents"),
      num("quantity", "Quantity to repack"),
      ref("destination_pallet", "Destination pallet", "pallets", true, {
        location_id: "$location_id",
      }),
      reason,
    ],
  },
  move_pallet: {
    label: "Move pallet within warehouse",
    help: "Moves every packed lot through the stock ledger. Use Warehouse transfer for a move between different warehouses.",
    module: "warehouse",
    confirm: true,
    states: ["empty", "packed"],
    fields: [ref("location_id", "Destination location", "locations"), reason],
  },
  retire_pallet: approve("Retire empty pallet", "warehouse", ["empty"]),
  dispatch_pallet_delivery: {
    label: "Post delivery from pallet",
    help: "Posts the selected delivery and removes the specified packed quantities atomically. Existing payment, stock, expiry and COA gates still apply.",
    module: "warehouse",
    confirm: true,
    targetField: "delivery_id",
    states: ["packed"],
    fields: [
      ref("delivery_id", "Draft delivery", "deliveries", true, {
        state: "draft",
      }),
      lines("contents", "Pallet picking", [
        local("content_id", "Packed lot", "contents"),
        num("quantity", "Quantity to dispatch"),
      ]),
      reason,
    ],
  },
  create_sample_request: {
    label: "New sample request",
    help: "Link the customer, product and intended quantity. Stock is reserved only when a released lot is prepared.",
    module: "crm",
    fields: [
      ref("customer_id", "Customer", "customers"),
      ref("opportunity_id", "Opportunity", "opportunities", false, {
        customer_id: "$customer_id",
      }),
      ref("product_id", "Product", "products"),
      ref("unit_id", "Sample unit", "units"),
      num("quantity", "Sample quantity"),
      area("purpose", "Purpose / technical requirement"),
      date("due_date", "Required by"),
      ref("assignee", "Owner", "staff", false),
    ],
  },
  approve_sample: approve("Approve sample request", "crm", ["requested"]),
  prepare_sample: {
    label: "Prepare sample stock",
    help: "Choose the actual released lot. Preparation reserves stock without posting an issue.",
    module: "crm",
    confirm: true,
    states: ["approved"],
    fields: [
      {
        ...ref("lot_id", "Released stock", "finished_inventory", true, {
          product_id: "$product_id",
          state: "released",
        }),
        pick: "lot_id",
      },
      ref("location_id", "Source location", "locations"),
      reason,
    ],
  },
  ship_sample: {
    label: "Ship prepared sample",
    help: "Creates one linked stock issue and retains the shipping reference. The lot must still be eligible when posted.",
    module: "crm",
    confirm: true,
    states: ["prepared"],
    fields: [
      text("tracking_reference", "Shipping / delivery reference"),
      reason,
    ],
  },
  record_sample_feedback: {
    label: "Record sample feedback",
    help: "Record the customer's technical or commercial feedback before preparing a quotation.",
    module: "crm",
    states: ["shipped", "feedback"],
    fields: [area("feedback", "Customer feedback")],
  },
  create_sample_quotation: {
    label: "Create quotation from sample",
    help: "Creates a Sales draft for this customer and product. Pricing remains editable through the controlled quotation workflow.",
    module: "sales",
    confirm: true,
    states: ["feedback"],
    fields: [
      num("quantity", "Quoted quantity"),
      num("price", "Unit price"),
      { ...text("currency", "Currency"), default: "IDR" },
      { ...num("tax_rate", "Tax (%)"), default: "0" },
      date("valid_until", "Valid until"),
      area("terms", "Commercial terms", false),
    ],
  },
  cancel_sample: approve("Cancel unshipped sample", "crm", [
    "requested",
    "approved",
    "prepared",
  ]),
  log_customer_interaction: {
    label: "Log customer interaction",
    help: "Keep the customer conversation and next action in one timeline. A due date creates an open follow-up; no external message is sent automatically.",
    module: "crm",
    fields: [
      ref("customer_id", "Customer", "customers"),
      ref("opportunity_id", "Opportunity", "opportunities", false, {
        customer_id: "$customer_id",
      }),
      ref("sample_id", "Sample request", "sample_requests", false, {
        customer_id: "$customer_id",
      }),
      select("kind", "Interaction type", [
        "call",
        "email",
        "meeting",
        "message",
        "note",
        "follow_up",
      ]),
      text("subject", "Subject"),
      area("notes", "Conversation / next action"),
      date("due_date", "Follow-up date", false),
      ref("assignee", "Owner", "staff", false),
    ],
  },
  complete_customer_interaction: {
    label: "Complete follow-up",
    help: "Record the outcome. Completing a task does not issue a quotation or change a customer's financial position.",
    module: "crm",
    states: ["open"],
    fields: [reason],
  },
  distribute_product_document: {
    label: "Record document sent",
    help: "Record which published revision was actually sent to this customer. This registers distribution; it does not send email or messages.",
    module: "crm",
    fields: [
      ref("customer_id", "Customer", "customers"),
      ref(
        "document_id",
        "Current product document",
        "product_documents",
        true,
        { state: "published" },
      ),
      text("recipient", "Recipient / contact"),
      select("channel", "Channel", ["email", "message", "portal", "other"]),
      date("sent_date", "Sent date"),
      area("evidence", "Sending evidence / reference"),
    ],
  },
  acknowledge_document_distribution: {
    label: "Record acknowledgment",
    help: "Keep evidence that the recipient acknowledged this specific document revision.",
    module: "crm",
    states: ["sent"],
    fields: [
      date("acknowledged_date", "Acknowledged date"),
      area("evidence", "Acknowledgment evidence"),
    ],
  },
  retract_document_distribution: {
    label: "Retract distribution record",
    help: "Record a correction without erasing what was previously distributed.",
    module: "crm",
    confirm: true,
    states: ["sent"],
    fields: [reason],
  },
};
workCommands.hold_material_quality = {
  label: "Review material hold",
  help: "A hold blocks use without changing physical stock. Release requires current material, supplier and expiry requirements to be satisfied.",
  module: "quality",
  verb: "approve",
  confirm: true,
  fields: [bool("hold", "Keep material on hold", true), reason],
};
workCommands.dispose_material_quality = {
  label: "Post approved material disposal",
  help: "An approved deviation and Warehouse approval are required. Release production reservations and unpack the quantity first. Disposal posts an immutable stock issue.",
  module: "quality",
  verb: "approve",
  confirm: true,
  fields: [
    ref("location_id", "Disposal location", "locations"),
    num("quantity", "Actual quantity disposed"),
    ref("deviation_id", "Approved deviation", "deviations", true, {
      state: "approved",
    }),
    reason,
  ],
};
export const workCollections: Record<string, WorkCollection> = {
  material_lots: {
    title: "Material lots & disposition",
    singular: "Material lot",
    module: "quality",
    description:
      "Review quarantine, supplier lots, holds and approved material dispositions.",
    actions: ["hold_material_quality", "dispose_material_quality"],
    columns: [
      c("label", "Material lot"),
      c("state", "Quality status"),
      c("held", "Held", "boolean"),
      c("expiry_date", "Expires", "date"),
    ],
  },

  warehouses: {
    title: "Warehouses",
    singular: "Warehouse",
    module: "warehouse",
    description: "Storage sites, locations and warehouse access.",
    create: "save_warehouse",
    actions: ["save_warehouse"],
    columns: [
      c("label", "Warehouse"),
      c("address", "Address"),
      c("state", "Status"),
    ],
  },
  locations: {
    title: "Storage locations",
    singular: "Location",
    module: "warehouse",
    description: "Keep every rack and bin linked to its warehouse.",
    create: "save_warehouse_location",
    actions: ["save_warehouse_location"],
    columns: [
      c("label", "Location"),
      c("warehouse", "Warehouse"),
      c("bin", "Rack / bin"),
      c("state", "Status"),
    ],
  },
  warehouse_access: {
    title: "Warehouse access",
    singular: "Access assignment",
    module: "warehouse",
    description:
      "Scope physical operations without replacing module permissions.",
    create: "set_warehouse_access",
    actions: ["set_warehouse_access"],
    columns: [c("label", "User"), c("state", "Access scope")],
  },
  formulas: {
    title: "Formulas & BOM",
    singular: "Formula",
    module: "production",
    description:
      "Approved recipes, packaging requirements and controlled revisions.",
    create: "save_formula",
    actions: [
      "save_formula",
      "approve_formula",
      "revise_formula",
      "withdraw_formula",
    ],
    columns: [
      ...identity,
      c("product", "Product"),
      c("revision", "Revision", "number"),
      c("output_quantity", "Reference output", "number"),
      c("unit", "Unit"),
      c("effective_date", "Effective", "date"),
    ],
  },
  manufacturing_orders: {
    title: "Production orders",
    singular: "Production order",
    module: "production",
    description:
      "Plan material requirements. Post actual use and reconcile every finished batch.",
    create: "create_manufacturing_order",
    actions: [
      "release_manufacturing_order",
      "reserve_manufacturing_material",
      "consume_material",
      "return_manufacturing_material",
      "release_material_reservation",
      "record_manufacturing_output",
      "complete_manufacturing_order",
      "close_manufacturing_order",
      "cancel_manufacturing_order",
    ],
    columns: [
      ...identity,
      c("product", "Product"),
      c("target_quantity", "Planned", "number"),
      c("actual_quantity", "Produced", "number"),
      c("yield_percent", "Yield (%)", "number"),
      c("warehouse", "Warehouse"),
      c("planned_date", "Planned date", "date"),
    ],
  },
  materials: {
    title: "Material release policies",
    singular: "Material policy",
    module: "quality",
    description:
      "Decide which materials require incoming inspection and qualified suppliers.",
    actions: ["set_material_quality_policy"],
    columns: [
      c("label", "Material"),
      c("unit", "Base unit"),
      c("requires_qc", "Incoming QC", "boolean"),
      c("requires_approved_supplier", "Qualified supplier", "boolean"),
    ],
  },
  material_specs: {
    title: "Material specifications",
    singular: "Material specification",
    module: "quality",
    description: "Versioned standards for incoming material inspections.",
    create: "save_material_spec",
    actions: [
      "save_material_spec",
      "approve_material_spec",
      "revise_material_spec",
      "withdraw_material_spec",
    ],
    columns: [
      ...identity,
      c("material", "Material"),
      c("revision", "Revision", "number"),
      c("effective_date", "Effective", "date"),
    ],
  },
  approved_suppliers: {
    title: "Approved material suppliers",
    singular: "Supplier qualification",
    module: "quality",
    description:
      "Qualifications apply to a material, supplier and validity period.",
    create: "save_approved_supplier",
    actions: ["approve_supplier", "withdraw_supplier"],
    columns: [
      ...identity,
      c("material", "Material"),
      c("supplier", "Supplier"),
      c("effective_date", "Effective", "date"),
      c("expiry_date", "Expires", "date"),
    ],
  },
  incoming_inspections: {
    title: "Incoming inspections",
    singular: "Incoming inspection",
    module: "quality",
    description:
      "Inspect received lots, record findings and release only eligible material.",
    create: "create_incoming_inspection",
    actions: [
      "save_incoming_results",
      "finalize_incoming_inspection",
      "retest_incoming_inspection",
    ],
    columns: [
      ...identity,
      c("material", "Material"),
      c("lot", "Supplier lot"),
      c("supplier", "Supplier"),
      c("date", "Inspection date", "date"),
    ],
  },
  deviations: {
    title: "Deviations & investigation",
    singular: "Deviation",
    module: "quality",
    description:
      "Investigate out-of-specification results and production variances.",
    create: "save_deviation",
    actions: [
      "save_deviation",
      "submit_deviation",
      "approve_deviation",
      "close_deviation",
    ],
    columns: [
      ...identity,
      c("material_lot", "Material lot"),
      c("production_order", "Production order"),
      c("assignee_name", "Owner"),
      c("due_date", "Due", "date"),
    ],
  },
  capas: {
    title: "Corrective & preventive actions",
    singular: "CAPA action",
    module: "quality",
    description:
      "Assign action, collect evidence and verify its effectiveness.",
    create: "save_capa",
    actions: ["save_capa", "submit_capa", "verify_capa"],
    columns: [
      ...identity,
      c("deviation", "Deviation"),
      c("kind", "Type"),
      c("assignee_name", "Owner"),
      c("due_date", "Due", "date"),
    ],
  },
  controlled_documents: {
    title: "Supplier & material documents",
    singular: "Controlled document",
    module: "documents",
    description: "Publish controlled revisions and monitor document validity.",
    create: "save_controlled_document",
    actions: [
      "save_controlled_document",
      "publish_controlled_document",
      "revise_controlled_document",
      "withdraw_controlled_document",
    ],
    columns: [
      ...identity,
      c("material", "Material"),
      c("supplier", "Supplier"),
      c("kind", "Type"),
      c("revision", "Revision", "number"),
      c("expiry_date", "Expires", "date"),
    ],
  },
  warehouse_transfers: {
    title: "Warehouse transfers",
    singular: "Warehouse transfer",
    module: "warehouse",
    description:
      "Track loose stock and pallets from dispatch through destination receipt.",
    create: "create_warehouse_transfer",
    actions: [
      "dispatch_warehouse_transfer",
      "receive_warehouse_transfer",
      "close_warehouse_transfer",
      "cancel_warehouse_transfer",
    ],
    columns: [
      ...identity,
      c("source", "From"),
      c("destination", "To"),
      c("date", "Transfer date", "date"),
    ],
  },
  pallets: {
    title: "Pallet tracking",
    singular: "Pallet",
    module: "warehouse",
    description:
      "Identify every pallet, inspect its contents and follow physical movements.",
    create: "create_pallet",
    actions: [
      "pack_pallet",
      "unpack_pallet",
      "repack_pallet",
      "move_pallet",
      "dispatch_pallet_delivery",
      "retire_pallet",
    ],
    columns: [
      ...identity,
      c("warehouse", "Warehouse"),
      c("location", "Location"),
    ],
  },
  sample_requests: {
    title: "Customer samples",
    singular: "Sample request",
    module: "crm",
    description:
      "From a technical request to preparation, shipment, feedback and quotation.",
    create: "create_sample_request",
    actions: [
      "approve_sample",
      "prepare_sample",
      "ship_sample",
      "record_sample_feedback",
      "create_sample_quotation",
      "cancel_sample",
    ],
    columns: [
      ...identity,
      c("customer", "Customer"),
      c("product", "Product"),
      c("quantity", "Quantity", "number"),
      c("unit", "Unit"),
      c("assignee_name", "Owner"),
      c("due_date", "Required by", "date"),
    ],
  },
  customer_interactions: {
    title: "Customer interactions",
    singular: "Customer interaction",
    module: "crm",
    description: "Conversation history and follow-up ownership in one place.",
    create: "log_customer_interaction",
    actions: ["complete_customer_interaction"],
    columns: [
      c("label", "Conversation"),
      c("state", "Status"),
      c("kind", "Type"),
      c("assignee_name", "Owner"),
      c("due_date", "Follow up", "date"),
    ],
  },
  document_distributions: {
    title: "Customer document distribution",
    singular: "Document distribution",
    module: "crm",
    description:
      "Know which revision was shared, with whom and when it was acknowledged.",
    create: "distribute_product_document",
    actions: [
      "acknowledge_document_distribution",
      "retract_document_distribution",
    ],
    columns: [
      c("label", "Distribution"),
      c("state", "Status"),
      c("recipient", "Recipient"),
      c("channel", "Channel"),
      c("revision", "Revision", "number"),
      c("sent_date", "Sent", "date"),
    ],
  },
  material_inventory: {
    title: "Material inventory",
    singular: "Material stock",
    module: "warehouse",
    description:
      "Eligible, reserved and packed stock by supplier lot and warehouse.",
    columns: [
      c("label", "Stock"),
      c("state", "Quality"),
      c("warehouse", "Warehouse"),
      c("on_hand", "On hand", "number"),
      c("reserved", "Reserved", "number"),
      c("available", "Available", "number"),
      c("packed", "Packed", "number"),
      c("unit", "Unit"),
      c("expiry_date", "Expires", "date"),
    ],
  },
  finished_inventory: {
    title: "Finished goods inventory",
    singular: "Finished stock",
    module: "warehouse",
    description:
      "Physical stock, reservations and pallet allocation by warehouse.",
    columns: [
      c("label", "Stock"),
      c("state", "Quality"),
      c("warehouse", "Warehouse"),
      c("on_hand", "On hand", "number"),
      c("reserved", "Reserved", "number"),
      c("available", "Available", "number"),
      c("packed", "Packed", "number"),
      c("unit", "Unit"),
      c("expiry_date", "Expires", "date"),
    ],
  },
};
export const workColumnDefinitions = Object.fromEntries(
  Object.entries(workCollections).map(([key, collection]) => [
    "work_" + key,
    collection.columns,
  ]),
);
export function workHref(entity: string, id?: string) {
  return (
    `/dashboard/${workPaths[entity] || "operations/" + entity}` +
    (id ? `?record=${encodeURIComponent(id)}` : "")
  );
}

for (const name of [
  "save_formula",
  "save_material_spec",
  "save_controlled_document",
])
  workCommands[name].states = ["draft"];
workCommands.save_deviation.states = ["open", "investigating"];
workCommands.save_capa.states = ["open", "in_progress"];
export const workPaths: Record<string, string> = {
  material_lots: "quality/material-lots",
  warehouses: "warehouse/sites",
  locations: "warehouse/locations",
  warehouse_access: "admin/settings/warehouse-access",
  formulas: "production/formulas",
  manufacturing_orders: "production/orders",
  materials: "quality/material-policies",
  material_specs: "quality/material-specifications",
  approved_suppliers: "quality/approved-suppliers",
  incoming_inspections: "quality/incoming-inspections",
  deviations: "quality/deviations",
  capas: "quality/capa",
  controlled_documents: "product-documents/materials",
  warehouse_transfers: "warehouse/transfers",
  pallets: "warehouse/pallets",
  sample_requests: "crm/samples",
  customer_interactions: "crm/interactions",
  document_distributions: "crm/documents",
  material_inventory: "warehouse/material-inventory",
  finished_inventory: "warehouse/inventory",
};

for (const name of [
  "reserve_manufacturing_material",
  "consume_material",
  "return_manufacturing_material",
  "release_material_reservation",
  "prepare_sample",
  "ship_sample",
])
  workCommands[name].requires = [{ module: "warehouse", verb: "write" }];
workCommands.dispose_material_quality.requires = [
  { module: "warehouse", verb: "approve" },
];
workCommands.create_sample_quotation.requires = [
  { module: "crm", verb: "write" },
];
workCommands.distribute_product_document.requires = [
  { module: "documents", verb: "read" },
];

// Submitting work and opening revisions are editing operations, not approvals.
for (const name of [
  "revise_formula",
  "revise_material_spec",
  "revise_controlled_document",
  "submit_deviation",
  "submit_capa",
  "cancel_warehouse_transfer",
  "retire_pallet",
  "cancel_sample",
])
  workCommands[name].verb = "write";
