import { entityColumns, type TableQuery } from "./schema";
export function tableParameters(_entity: string, query: TableQuery) {
  const p = new URLSearchParams();
  for (const f of query.filters) {
    const op = {
      contains: "imatch",
      starts: "imatch",
      empty: "is",
      not_empty: "not.is",
      neq: "neq",
      in: "in",
      eq: "eq",
      gt: "gt",
      gte: "gte",
      lt: "lt",
      lte: "lte",
    }[f.op];
    const literal = f.value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const value =
      f.op === "in"
        ? "(" +
          f.value
            .split(",")
            .map((v) => JSON.stringify(v.trim()))
            .join(",") +
          ")"
        : f.op === "contains"
          ? literal
          : f.op === "starts"
            ? `^${literal}`
            : ["empty", "not_empty"].includes(f.op)
              ? "null"
              : f.value;
    p.append(f.field, `${op}.${value}`);
  }
  if (query.sorts.length)
    p.set(
      "order",
      [
        ...query.sorts.map((s) => `${s.field}.${s.direction}.nullslast`),
        "id.asc",
      ].join(","),
    );
  return p;
}
export function queryTypes(entity: string, query: TableQuery) {
  return {
    ...query,
    summary: (entityColumns[entity] || [])
      .filter(
        (c) =>
          c.type === "number" &&
          [
            "amount",
            "outstanding",
            "on_hand",
            "reserved",
            "available",
            "quantity",
            "delta",
            "totals.total",
            "total",
            "expected_value",
            "credit_limit",
          ].includes(c.key),
      )
      .map((c) => c.key),
    filters: query.filters.map((f) => ({
      ...f,
      type:
        entityColumns[entity]?.find((c) => c.key === f.field)?.type || "text",
    })),
    sorts: query.sorts.map((s) => ({
      ...s,
      type:
        entityColumns[entity]?.find((c) => c.key === s.field)?.type || "text",
    })),
  };
}
export function applyTableQuery<
  T extends {
    filter: (column: string, operator: string, value: unknown) => T;
    or: (filters: string) => T;
    order: (
      column: string,
      options: { ascending: boolean; nullsFirst?: boolean },
    ) => T;
  },
>(builder: T, query: TableQuery): T {
  let q = builder;
  for (const f of query.filters) {
    const column = Object.values(entityColumns)
      .flat()
      .find((c) => c.key === f.field);
    if (
      column?.type === "date" &&
      ["created_at", "waktu"].includes(f.field) &&
      !["empty", "not_empty"].includes(f.op)
    ) {
      const from = f.value + "T00:00:00+07:00",
        to = f.value + "T23:59:59.999999+07:00";
      if (f.op === "eq") {
        q = q.filter(f.field, "gte", from).filter(f.field, "lte", to);
        continue;
      }
      if (f.op === "neq") {
        q = q.or(`${f.field}.lt.${from},${f.field}.gt.${to}`);
        continue;
      }
      q = q.filter(f.field, f.op, f.op === "lte" || f.op === "gt" ? to : from);
      continue;
    }
    for (const [field, value] of tableParameters("", {
      filters: [f],
      sorts: [],
    })) {
      const dot = value.indexOf(".");
      q = q.filter(field, value.slice(0, dot), value.slice(dot + 1));
    }
  }
  for (const sort of query.sorts)
    q = q.order(sort.field, {
      ascending: sort.direction === "asc",
      nullsFirst: false,
    });
  return q;
}
