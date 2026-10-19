import "server-only";
import { erpRpc } from "./server";
import type { ERPRow } from "./schema";
export async function linkedQuoteOrder(quote: ERPRow) {
  const result = await erpRpc("erp_quote_order", { p_quote: quote.id });
  if (!result.error || !["PGRST202", "42883"].includes(result.error.code))
    return result;
  // Compatibility before migration 009: use only authorized RPCs, never direct tables.
  // Narrow by the same immutable customer name stored in the quote/order snapshot.
  for (let page = 1; page <= 4; page++) {
    const orders = await erpRpc("erp_read", {
      p_entity: "orders",
      p_search: quote.customer || "",
      p_page: page,
    });
    if (orders.error) return orders;
    for (const candidate of orders.data.rows as ERPRow[]) {
      const detail = await erpRpc("erp_read", {
        p_entity: "orders",
        p_id: candidate.id,
      });
      if (detail.error) return detail;
      const order = detail.data.rows[0] as ERPRow | undefined;
      if (
        order &&
        (order.quote_id === quote.id ||
          (quote.root_id && order.root_id === quote.root_id))
      )
        return {
          data: { id: order.id, number: order.number, state: order.state },
          error: null,
        };
    }
    if (page * orders.data.page_size >= orders.data.total)
      return { data: null, error: null };
  }
  return {
    data: null,
    error: {
      code: "P0001",
      message:
        "Could not verify the linked sales order. Retry or contact your administrator.",
    },
  };
}
