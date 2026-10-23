import "server-only";
import { erpRpc } from "@/lib/erp/server";
import {
  approvalActions,
  approvalFromEvents,
  type ApprovalStamp,
} from "./approval";

/** Uses existing session-authorized readers; does not grant any new database access. */
export async function loadDocumentApproval(
  entity: string,
  id: string,
  state: string,
): Promise<{ approval: ApprovalStamp | null; error?: true }> {
  const actions = approvalActions(entity, state);
  if (!actions.length) return { approval: null };
  const operational = [
    "manufacturing_orders",
    "incoming_inspections",
    "warehouse_transfers",
  ].includes(entity);
  for (let page = 1; ; page++) {
    const result = operational
      ? await erpRpc("erp_work_read", {
          p_entity: "history",
          p_query: {
            id,
            source: entity,
            page,
            grid: {
              filters: [
                { field: "record_id", op: "eq", type: "text", value: id },
                {
                  field: "action",
                  op: "in",
                  type: "text",
                  value: actions.join(","),
                },
              ],
              sorts: [{ field: "id", direction: "desc", type: "number" }],
            },
          },
        })
      : await erpRpc("erp_controls", {
          p_entity: entity,
          p_id: id,
          p_page: page,
        });
    if (result.error) return { approval: null, error: true };
    const events = operational
      ? result.data.rows
      : result.data.rows?.[0]?.history;
    const approval = approvalFromEvents(entity, id, state, events || []);
    if (approval) return { approval };
    if (
      !events?.length ||
      page * Number(result.data.page_size) >= Number(result.data.total)
    )
      return { approval: null };
  }
}
