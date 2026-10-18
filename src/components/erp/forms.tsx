"use client";
import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ERPForm, ERPField } from "./shared";
import { ERPPicker } from "./picker";
import { businessDate } from "@/lib/domain/validation";
import { coaExpiryDate } from "@/lib/domain/coa-dates";
import { shiftDate } from "@/lib/dashboard-analytics";
import {
  decimal,
  type ERPRow,
  type ERPReservation,
  type OrderLine,
  type ERPAction,
} from "@/lib/erp/schema";
type Done = (id?: string, entity?: string) => void;
function ProductInput({
  product,
  onChange,
}: {
  product: ERPRow | null;
  onChange: (p: ERPRow) => void;
}) {
  return (
    <ERPPicker
      entity="catalog"
      label="Product"
      value={product}
      onChange={onChange}
    />
  );
}
function UnitInput({
  product,
  value,
  onChange,
}: {
  product: ERPRow | null;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <ERPField label="Unit">
      <select required value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Select…</option>
        {product?.units?.map((u) => (
          <option key={u.id} value={u.id}>
            {u.code}
            {u.is_base ? " · base" : ""} (× {decimal(u.factor)})
          </option>
        ))}
      </select>
      {product && product.units?.length === 0 && (
        <small role="alert">
          Configure this product in Settings → Product units.
        </small>
      )}
    </ERPField>
  );
}
export function CustomerForm({ row, onDone }: { row?: ERPRow; onDone: Done }) {
  const [value, setValue] = useState({
    id: row?.id,
    name: row?.name || "",
    contact: row?.contact || "",
    email: row?.email || "",
    phone: row?.phone || "",
    tax_id: row?.tax_id || "",
    billing_address: row?.billing_address || "",
    shipping_address: row?.shipping_address || "",
    payment_terms: row?.payment_terms || "",
  });
  return (
    <ERPForm action="save_customer" payload={value} onDone={onDone}>
      <div className="erp-form-grid">
        {(
          [
            "name",
            "contact",
            "email",
            "phone",
            "tax_id",
            "billing_address",
            "shipping_address",
            "payment_terms",
          ] as const
        ).map((key) => (
          <ERPField
            key={key}
            label={
              {
                name: "Company name",
                contact: "Contact person",
                email: "Email",
                phone: "Phone",
                tax_id: "Tax identifier",
                billing_address: "Billing address",
                shipping_address: "Shipping address",
                payment_terms: "Payment terms",
              }[key]
            }
          >
            {key.includes("address") || key === "payment_terms" ? (
              <textarea
                value={value[key]}
                maxLength={1000}
                onChange={(e) => setValue({ ...value, [key]: e.target.value })}
              />
            ) : (
              <Input
                required={key === "name"}
                type={key === "email" ? "email" : "text"}
                value={value[key]}
                maxLength={key === "name" ? 200 : 1000}
                onChange={(e) => setValue({ ...value, [key]: e.target.value })}
              />
            )}
          </ERPField>
        ))}
      </div>
    </ERPForm>
  );
}
type MoveLine = {
  product: ERPRow | null;
  stock: ERPRow | null;
  unit_id: string;
  quantity: string;
  lot_number: string;
  mfg_date: string;
};
const emptyMove = (): MoveLine => ({
  product: null,
  stock: null,
  unit_id: "",
  quantity: "",
  lot_number: "",
  mfg_date: businessDate(),
});
export function MoveForm({
  production = false,
  row,
  onDone,
}: {
  production?: boolean;
  row?: ERPRow;
  onDone: Done;
}) {
  const [kind, setKind] = useState(
      row?.kind || (production ? "production" : "receipt"),
    ),
    [date, setDate] = useState(row?.date || businessDate()),
    [reason, setReason] = useState(row?.reason || "");
  const [from, setFrom] = useState<ERPRow | null>(
      row?.from_location ? { id: row.from_location, label: row.source } : null,
    ),
    [to, setTo] = useState<ERPRow | null>(
      row?.to_location ? { id: row.to_location, label: row.destination } : null,
    );
  const [lines, setLines] = useState<MoveLine[]>(
    row?.lines?.map((l) => ({
      product: {
        id: l.product_id,
        label: l.product,
        units: [
          {
            id: l.unit_id,
            code: l.unit,
            factor: l.factor,
            is_base: l.factor === "1.000000" || l.factor === "1",
          },
        ],
      },
      stock: l.lot_id
        ? {
            id: l.lot_id,
            lot_id: l.lot_id,
            product_id: l.product_id,
            label: l.product + " · " + l.lot,
            unit: l.base_unit,
            location_id: row.from_location,
          }
        : null,
      unit_id: l.unit_id,
      quantity: l.quantity,
      lot_number: l.lot || "",
      mfg_date: l.mfg_date || businessDate(),
    })) || [emptyMove()],
  );
  const inbound = kind === "production" || kind === "receipt";
  function change(i: number, patch: Partial<MoveLine>) {
    setLines((v) => v.map((l, n) => (n === i ? { ...l, ...patch } : l)));
  }
  const payload = {
    id: row?.id,
    version: row?.version,
    kind,
    date,
    reason,
    from_location: from?.id || "",
    to_location: to?.id || "",
    lines: lines.map((l) =>
      inbound
        ? {
            product_id: l.product?.id,
            unit_id: l.unit_id,
            quantity: l.quantity,
            lot_number: production ? undefined : l.lot_number,
            mfg_date: l.mfg_date,
          }
        : { lot_id: l.stock?.lot_id, unit_id: l.unit_id, quantity: l.quantity },
    ),
  };
  return (
    <ERPForm
      action="save_move"
      payload={payload}
      onDone={onDone}
      label="Save draft"
    >
      <div className="erp-form-grid">
        {!production && !row && (
          <ERPField label="Movement type">
            <select
              value={kind}
              onChange={(e) => {
                setKind(e.target.value);
                setLines([emptyMove()]);
                setFrom(null);
                setTo(null);
              }}
            >
              <option value="receipt">Receipt</option>
              <option value="transfer">Transfer</option>
              <option value="issue">Internal issue / sample / damage</option>
            </select>
          </ERPField>
        )}
        <ERPField label="Posting date">
          <Input
            type="date"
            value={date}
            required
            max={businessDate()}
            onChange={(e) => setDate(e.target.value)}
          />
        </ERPField>
        {(inbound || kind === "transfer") && (
          <ERPPicker
            entity="locations"
            label="Destination location"
            value={to}
            onChange={setTo}
          />
        )}
      </div>
      {!inbound && (
        <p className="erp-notice">
          Select stock at its source location. Reserved quantities cannot be
          moved.
        </p>
      )}
      {production && (
        <p className="erp-notice">
          Each line is one batch. The server assigns its official lot number
          when you post. Configure the product series in Master data first.
        </p>
      )}
      {lines.map((line, i) => (
        <div key={i} className="erp-line-editor">
          <div className="erp-line-title">
            <strong>Line {i + 1}</strong>
            {lines.length > 1 && (
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={"Remove line " + (i + 1)}
                onClick={() => setLines((v) => v.filter((_, n) => n !== i))}
              >
                <Trash2 />
              </Button>
            )}
          </div>
          {inbound ? (
            <ProductInput
              product={line.product}
              onChange={(p) =>
                change(i, {
                  product: p,
                  unit_id: p.units?.find((u) => u.is_base)?.id || "",
                })
              }
            />
          ) : (
            <ERPPicker
              entity="stock"
              label="Source stock"
              value={line.stock}
              onChange={(s) => {
                setFrom({ id: s.location_id!, label: s.location });
                change(i, {
                  stock: s,
                  product: { id: s.product_id!, units: [] },
                  unit_id: "",
                });
              }}
            />
          )}
          <div className="erp-form-grid">
            {inbound ? (
              <UnitInput
                product={line.product}
                value={line.unit_id}
                onChange={(v) => change(i, { unit_id: v })}
              />
            ) : (
              <ProductUnitLookup
                stock={line.stock}
                value={line.unit_id}
                onChange={(v, p) => change(i, { unit_id: v, product: p })}
              />
            )}
            <ERPField label="Quantity">
              <Input
                inputMode="decimal"
                value={line.quantity}
                required
                onChange={(e) => change(i, { quantity: e.target.value })}
              />
            </ERPField>
            {inbound && (
              <>
                {!production && (
                  <ERPField label="Lot / batch number">
                    <Input
                      value={line.lot_number}
                      required
                      maxLength={150}
                      onChange={(e) =>
                        change(i, { lot_number: e.target.value })
                      }
                    />
                  </ERPField>
                )}
                <ERPField
                  label="Manufacturing date"
                  hint={
                    line.mfg_date
                      ? "Expiry: " + coaExpiryDate(line.mfg_date)
                      : undefined
                  }
                >
                  <Input
                    type="date"
                    required
                    max={businessDate()}
                    value={line.mfg_date}
                    onChange={(e) => change(i, { mfg_date: e.target.value })}
                  />
                </ERPField>
              </>
            )}
          </div>
        </div>
      ))}
      {inbound && lines.length < 100 && (
        <Button
          variant="outline"
          onClick={() => setLines((v) => [...v, emptyMove()])}
        >
          <Plus /> Add product line
        </Button>
      )}
      <ERPField label="Reference / reason">
        <textarea
          required
          value={reason}
          maxLength={1000}
          onChange={(e) => setReason(e.target.value)}
        />
      </ERPField>
      <p className="erp-notice">
        Saving a draft does not change stock. Post it after review.
        {inbound
          ? " Received goods remain unavailable for sales until released."
          : ""}
      </p>
    </ERPForm>
  );
}
import { useERPPage } from "./data";
function ProductUnitLookup({
  stock,
  value,
  onChange,
}: {
  stock: ERPRow | null;
  value: string;
  onChange: (v: string, p: ERPRow) => void;
}) {
  const { data } = useERPPage(
    "catalog",
    "",
    "",
    1,
    stock?.product_id,
    Boolean(stock),
  );
  const product = stock ? data.rows[0] || null : null;
  return (
    <UnitInput
      product={product}
      value={value}
      onChange={(v) => {
        if (product) onChange(v, product);
      }}
    />
  );
}
type QuoteEditLine = {
  product: ERPRow | null;
  unit_id: string;
  quantity: string;
  price: string;
  discount: string;
};
export function QuoteForm({ row, onDone }: { row?: ERPRow; onDone: Done }) {
  const [customer, setCustomer] = useState<ERPRow | null>(
    row?.customer_id ? { id: row.customer_id, label: row.customer } : null,
  );
  const [value, setValue] = useState({
    id: row?.id,
    version: row?.version,
    date: row?.date || businessDate(),
    valid_until: row?.valid_until || shiftDate(businessDate(), 30),
    currency: row?.currency || "IDR",
    terms: row?.terms || "",
    delivery_terms: row?.delivery_terms || "",
    lead_time: row?.lead_time || "",
    tax_rate: String(row?.tax_rate ?? "0"),
    freight: String(row?.freight ?? "0"),
  });
  const [lines, setLines] = useState<QuoteEditLine[]>(
    row?.lines?.map((l) => ({
      product: {
        id: l.product_id,
        label: l.product,
        units: [
          {
            id: l.unit_id,
            code: l.unit,
            factor: l.factor,
            is_base: l.unit === l.base_unit,
          },
        ],
      },
      unit_id: l.unit_id,
      quantity: l.quantity,
      price: l.price || "0",
      discount: l.discount || "0",
    })) || [
      { product: null, unit_id: "", quantity: "", price: "", discount: "0" },
    ],
  );
  function change(i: number, patch: Partial<QuoteEditLine>) {
    setLines((v) => v.map((l, n) => (i === n ? { ...l, ...patch } : l)));
  }
  return (
    <ERPForm
      action="save_quote"
      payload={{
        ...value,
        customer_id: customer?.id,
        lines: lines.map((l) => ({
          product_id: l.product?.id,
          unit_id: l.unit_id,
          quantity: l.quantity,
          price: l.price,
          discount: l.discount,
        })),
      }}
      onDone={onDone}
      label="Save quotation draft"
    >
      <ERPPicker
        entity="customers"
        label="Customer"
        value={customer}
        onChange={setCustomer}
      />
      <div className="erp-form-grid">
        {(["date", "valid_until", "currency", "lead_time"] as const).map(
          (key) => (
            <ERPField
              key={key}
              label={
                {
                  date: "Quotation date",
                  valid_until: "Valid until",
                  currency: "Currency code",
                  lead_time: "Lead time",
                }[key]
              }
            >
              <Input
                required={key !== "lead_time"}
                type={key === "date" || key === "valid_until" ? "date" : "text"}
                value={value[key]}
                maxLength={key === "currency" ? 3 : 1000}
                onChange={(e) =>
                  setValue({
                    ...value,
                    [key]:
                      key === "currency"
                        ? e.target.value.toUpperCase()
                        : e.target.value,
                  })
                }
              />
            </ERPField>
          ),
        )}
      </div>
      {lines.map((line, i) => (
        <div key={i} className="erp-line-editor">
          <div className="erp-line-title">
            <strong>Item {i + 1}</strong>
            {lines.length > 1 && (
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={"Remove item " + (i + 1)}
                onClick={() => setLines((v) => v.filter((_, n) => n !== i))}
              >
                <Trash2 />
              </Button>
            )}
          </div>
          <ProductInput
            product={line.product}
            onChange={(p) =>
              change(i, {
                product: p,
                unit_id: p.units?.find((u) => u.is_base)?.id || "",
              })
            }
          />
          <div className="erp-form-grid">
            <UnitInput
              product={line.product}
              value={line.unit_id}
              onChange={(v) => change(i, { unit_id: v })}
            />
            {(["quantity", "price", "discount"] as const).map((key) => (
              <ERPField
                label={
                  {
                    quantity: "Quantity",
                    price: "Unit price",
                    discount: "Discount %",
                  }[key]
                }
                key={key}
              >
                <Input
                  required
                  inputMode="decimal"
                  value={line[key]}
                  onChange={(e) => change(i, { [key]: e.target.value })}
                />
              </ERPField>
            ))}
          </div>
        </div>
      ))}
      {lines.length < 100 && (
        <Button
          variant="outline"
          onClick={() =>
            setLines((v) => [
              ...v,
              {
                product: null,
                unit_id: "",
                quantity: "",
                price: "",
                discount: "0",
              },
            ])
          }
        >
          <Plus /> Add item
        </Button>
      )}
      <div className="erp-form-grid">
        {(["tax_rate", "freight", "terms", "delivery_terms"] as const).map(
          (key) => (
            <ERPField
              key={key}
              label={
                {
                  tax_rate: "Tax %",
                  freight: "Freight amount",
                  terms: "Payment & commercial terms",
                  delivery_terms: "Delivery terms",
                }[key]
              }
            >
              {key === "terms" || key === "delivery_terms" ? (
                <textarea
                  value={value[key]}
                  maxLength={1000}
                  onChange={(e) =>
                    setValue({ ...value, [key]: e.target.value })
                  }
                />
              ) : (
                <Input
                  required
                  inputMode="decimal"
                  value={value[key]}
                  onChange={(e) =>
                    setValue({ ...value, [key]: e.target.value })
                  }
                />
              )}
            </ERPField>
          ),
        )}
      </div>
      <p className="erp-notice">
        Amounts are calculated on the server. Discounts above 10% require
        approval. Issued quotations cannot be edited; create a revision instead.
      </p>
    </ERPForm>
  );
}
export function CountForm({ onDone }: { onDone: Done }) {
  const [loc, setLoc] = useState<ERPRow | null>(null),
    [date, setDate] = useState(businessDate()),
    [blind, setBlind] = useState(true),
    [reason, setReason] = useState("");
  return (
    <ERPForm
      action="create_count"
      payload={{ location_id: loc?.id, scheduled_date: date, blind, reason }}
      onDone={onDone}
      label="Plan stock count"
    >
      <ERPPicker
        entity="locations"
        label="Location"
        value={loc}
        onChange={setLoc}
      />
      <ERPField label="Scheduled date">
        <Input
          type="date"
          required
          value={date}
          onChange={(e) => setDate(e.target.value)}
        />
      </ERPField>
      <label className="erp-check">
        <input
          type="checkbox"
          checked={blind}
          onChange={(e) => setBlind(e.target.checked)}
        />
        Blind count: hide system quantities on the count sheet
      </label>
      <ERPField label="Reference">
        <textarea
          value={reason}
          maxLength={1000}
          onChange={(e) => setReason(e.target.value)}
        />
      </ERPField>
      <p className="erp-notice">
        The location freezes only when the count is started. All counts,
        including zero, must be entered before submission.
      </p>
    </ERPForm>
  );
}
export function CountEntryForm({
  countId,
  line,
  onDone,
}: {
  countId: string;
  line: {
    lot_id: string;
    product: string;
    lot: string;
    unit: string;
    counted: string | null;
  };
  onDone: Done;
}) {
  const [qty, setQty] = useState(line.counted || "");
  return (
    <ERPForm
      action="count_line"
      payload={{ id: countId, lot_id: line.lot_id, quantity: qty }}
      onDone={onDone}
    >
      <p>
        {line.product} · {line.lot}
      </p>
      <ERPField label={"Counted quantity (" + line.unit + ")"}>
        <Input
          required
          inputMode="decimal"
          value={qty}
          onChange={(e) => setQty(e.target.value)}
        />
      </ERPField>
    </ERPForm>
  );
}
export function CountAddForm({ id, onDone }: { id: string; onDone: Done }) {
  const [p, setP] = useState<ERPRow | null>(null),
    [lot, setLot] = useState(""),
    [mfg, setMfg] = useState("");
  return (
    <ERPForm
      action="count_add_lot"
      payload={{ id, product_id: p?.id, lot_number: lot, mfg_date: mfg }}
      onDone={onDone}
    >
      <ProductInput product={p} onChange={setP} />
      <ERPField label="Lot number">
        <Input
          required
          value={lot}
          maxLength={150}
          onChange={(e) => setLot(e.target.value)}
        />
      </ERPField>
      <ERPField label="Manufacturing date (optional)">
        <Input
          type="date"
          value={mfg}
          max={businessDate()}
          onChange={(e) => setMfg(e.target.value)}
        />
      </ERPField>
      <p className="erp-notice">
        Unlisted goods are added to this count. New lots remain in quarantine.
      </p>
    </ERPForm>
  );
}
export function ReserveForm({
  line,
  onDone,
}: {
  line: OrderLine;
  onDone: Done;
}) {
  const [stock, setStock] = useState<ERPRow | null>(null),
    [quantity, setQuantity] = useState(line.unreserved || "");
  return (
    <ERPForm
      action="reserve"
      payload={{
        order_line_id: line.id,
        lot_id: stock?.lot_id,
        location_id: stock?.location_id,
        quantity,
      }}
      onDone={onDone}
    >
      <p>
        {line.product} · {decimal(line.unreserved)} {line.unit} unreserved
      </p>
      <ERPPicker
        entity="stock"
        label="Stock lot (earliest expiry first)"
        value={stock}
        filterProduct={line.product_id}
        onChange={setStock}
      />
      {stock && (
        <p className="erp-notice">
          {stock.qc_status} · Expiry {stock.expiry_date || "not recorded"} ·
          Available {decimal(stock.available)} {stock.unit}
        </p>
      )}
      <ERPField label={"Reserve quantity (" + line.unit + ")"}>
        <Input
          required
          inputMode="decimal"
          value={quantity}
          onChange={(e) => setQuantity(e.target.value)}
        />
      </ERPField>
    </ERPForm>
  );
}
export function DeliveryForm({ row, onDone }: { row: ERPRow; onDone: Done }) {
  const active = (row.reservations || []).filter(
    (r) =>
      r.state === "active" && r.remaining !== "0" && r.remaining !== "0.000000",
  );
  const [location, setLocation] = useState(active[0]?.location_id || ""),
    [selected, setSelected] = useState<Record<string, string>>(
      Object.fromEntries(active.map((r) => [r.id, r.remaining])),
    ),
    [reason, setReason] = useState("");
  const lines = active
    .filter((r) => r.location_id === location && selected[r.id])
    .map((r) => ({ reservation_id: r.id, quantity: selected[r.id] }));
  return (
    <ERPForm
      action="create_delivery"
      payload={{ order_id: row.id, reason, lines }}
      onDone={onDone}
      label="Create delivery draft"
      disabled={lines.length === 0}
    >
      <ERPField label="Source location">
        <select value={location} onChange={(e) => setLocation(e.target.value)}>
          {Array.from(
            new Map(active.map((r) => [r.location_id, r.location])).entries(),
          ).map(([id, name]) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </select>
      </ERPField>
      {active
        .filter((r) => r.location_id === location)
        .map((r: ERPReservation) => (
          <ERPField
            key={r.id}
            label={r.product + " · " + r.lot + " (" + r.unit + ")"}
            hint={
              "Reserved: " + decimal(r.remaining) + ". Leave blank to exclude."
            }
          >
            <Input
              inputMode="decimal"
              value={selected[r.id] || ""}
              onChange={(e) =>
                setSelected({ ...selected, [r.id]: e.target.value })
              }
            />
          </ERPField>
        ))}
      <ERPField label="Delivery reference / remarks">
        <textarea
          value={reason}
          maxLength={1000}
          onChange={(e) => setReason(e.target.value)}
        />
      </ERPField>
      <p className="erp-notice">
        Post the draft after picking. Lots must still be released and unexpired
        at posting. If Quality is enabled, matching COAs are attached to the
        shipment.
      </p>
    </ERPForm>
  );
}
export function ConfigurationForm({
  action,
  onDone,
}: {
  action: ERPAction;
  onDone: Done;
}) {
  const [value, setValue] = useState({
      code: "",
      name: "",
      factor: "1",
      is_base: true,
      module: "warehouse",
      read: true,
      write: false,
      approve: false,
    }),
    [product, setProduct] = useState<ERPRow | null>(null),
    [unit, setUnit] = useState<ERPRow | null>(null),
    [user, setUser] = useState<ERPRow | null>(null);
  const payload =
    action === "save_conversion"
      ? {
          product_id: product?.id,
          unit_id: unit?.id,
          factor: value.factor,
          is_base: value.is_base,
        }
      : action === "set_access"
        ? {
            user_id: user?.id,
            module: value.module,
            read: value.read,
            write: value.write,
            approve: value.approve,
          }
        : { code: value.code, name: value.name };
  return (
    <ERPForm action={action} payload={payload} onDone={onDone}>
      {action === "save_conversion" ? (
        <>
          <ProductInput product={product} onChange={setProduct} />
          <ERPPicker
            entity="units"
            label="Unit"
            value={unit}
            onChange={setUnit}
          />
          <ERPField label="Base units per entered unit">
            <Input
              value={value.factor}
              required
              inputMode="decimal"
              onChange={(e) => setValue({ ...value, factor: e.target.value })}
            />
          </ERPField>
          <label className="erp-check">
            <input
              type="checkbox"
              checked={value.is_base}
              onChange={(e) =>
                setValue({
                  ...value,
                  is_base: e.target.checked,
                  factor: e.target.checked ? "1" : value.factor,
                })
              }
            />
            Set as base unit (factor 1)
          </label>
          <p className="erp-notice">
            Example: one bag = 25 kg. A base unit cannot change once
            transactions reference the product. Changing a conversion affects
            future transactions only.
          </p>
        </>
      ) : action === "set_access" ? (
        <>
          <ERPPicker
            entity="users"
            label="User"
            value={user}
            onChange={setUser}
          />
          <ERPField label="Module">
            <select
              value={value.module}
              onChange={(e) => setValue({ ...value, module: e.target.value })}
            >
              <option value="warehouse">Warehouse</option>
              <option value="production">Production</option>
              <option value="sales">Sales</option>
              <option value="quality">Quality</option>
            </select>
          </ERPField>
          {(["read", "write", "approve"] as const).map((v) => (
            <label className="erp-check" key={v}>
              <input
                type="checkbox"
                checked={value[v]}
                onChange={(e) => setValue({ ...value, [v]: e.target.checked })}
              />
              {v[0].toUpperCase() + v.slice(1)}
            </label>
          ))}
          <p className="erp-notice">
            Administrators retain access. QC actions also follow the existing QC
            role. Sales reservation needs Warehouse read access; delivery
            posting needs Warehouse write access.
          </p>
        </>
      ) : (
        <>
          <ERPField label="Code">
            <Input
              required
              value={value.code}
              maxLength={action === "save_unit" ? 20 : 30}
              onChange={(e) => setValue({ ...value, code: e.target.value })}
            />
          </ERPField>
          <ERPField label="Name">
            <Input
              required
              value={value.name}
              maxLength={action === "save_unit" ? 80 : 100}
              onChange={(e) => setValue({ ...value, name: e.target.value })}
            />
          </ERPField>
        </>
      )}
    </ERPForm>
  );
}

export function AssignCountForm({ id, onDone }: { id: string; onDone: Done }) {
  const [user, setUser] = useState<ERPRow | null>(null);
  return (
    <ERPForm
      action="assign_count"
      payload={{ id, user_id: user?.id }}
      onDone={onDone}
    >
      <ERPPicker
        entity="counters"
        label="Assigned counter"
        value={user}
        onChange={setUser}
      />
    </ERPForm>
  );
}
