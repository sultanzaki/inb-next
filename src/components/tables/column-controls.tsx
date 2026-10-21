"use client";
import { useRef } from "react";
import { MoreHorizontal } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import type { Column } from "@/lib/tables/schema";
import type { TableState } from "./use-table-state";
export function ColumnMenu({
  column,
  state,
  onFilter,
}: {
  column: Column;
  state: TableState;
  onFilter: () => void;
}) {
  const { query, layout } = state;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="grid-column-menu"
        aria-label={`Options for ${column.label}`}
      >
        <MoreHorizontal className="size-3.5" />
      </DropdownMenuTrigger>
      <DropdownMenuContent className="min-w-48">
        <DropdownMenuItem
          onClick={() =>
            state.setQuery({
              ...query,
              sorts: [{ field: column.key, direction: "asc" }],
            })
          }
        >
          Sort ascending
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() =>
            state.setQuery({
              ...query,
              sorts: [{ field: column.key, direction: "desc" }],
            })
          }
        >
          Sort descending
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() =>
            state.setQuery({
              ...query,
              sorts: query.sorts.filter((s) => s.field !== column.key),
            })
          }
        >
          Clear column sort
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onFilter}>
          Filter this column
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() =>
            state.setLayout((layout) => ({
              ...layout,
              pinned: layout.pinned.includes(column.key) ? [] : [column.key],
            }))
          }
        >
          {layout.pinned.includes(column.key) ? "Unpin column" : "Pin column"}
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={column.key === state.columns[0].key}
          onClick={() =>
            state.setLayout((layout) => ({
              ...layout,
              hidden: [...layout.hidden, column.key],
            }))
          }
        >
          Hide column
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
export function ColumnResize({
  label,
  width,
  onResize,
}: {
  label: string;
  width: number;
  onResize: (width: number) => void;
}) {
  const drag = useRef<{ start: number; width: number } | null>(null);
  return (
    <button
      className="grid-column-resize"
      role="separator"
      aria-orientation="vertical"
      aria-label={`Resize ${label}`}
      aria-valuemin={100}
      aria-valuemax={480}
      aria-valuenow={width}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        drag.current = {
          start: e.clientX,
          width:
            e.currentTarget.closest("th")?.getBoundingClientRect().width ||
            width,
        };
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        if (drag.current)
          onResize(
            Math.max(
              100,
              Math.min(
                480,
                Math.round(drag.current.width + e.clientX - drag.current.start),
              ),
            ),
          );
      }}
      onPointerUp={() => {
        drag.current = null;
      }}
      onPointerCancel={() => {
        drag.current = null;
      }}
      onKeyDown={(e) => {
        if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) {
          e.preventDefault();
          onResize(
            e.key === "Home"
              ? 100
              : e.key === "End"
                ? 480
                : Math.max(
                    100,
                    Math.min(480, width + (e.key === "ArrowRight" ? 20 : -20)),
                  ),
          );
        }
      }}
      onDoubleClick={() => onResize(160)}
    />
  );
}
