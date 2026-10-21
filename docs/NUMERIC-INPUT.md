# Numeric input behavior

ERP quantities, prices, amounts, stock limits and percentages share one numeric input. Thousands are grouped as you type using dots; a comma separates decimals. The decimal key also enters a comma. Form state and API payloads contain ungrouped decimal strings, preserving precision without converting money through JavaScript floating-point numbers.

Editing supports selection replacement, insertion in the middle and deletion next to grouping marks. Pasted localized amounts, including `Rp` or `IDR`, are parsed explicitly; ambiguous or malformed pasted separators remain invalid rather than silently changing the amount. Existing database values use decimal-point transport notation and are formatted separately from user input. Trailing database zeros are hidden when opening a field and after blur; deliberate decimal zeros are retained while typing.

Clearing a suggested payment-request or allocation amount leaves the field empty. Automatic suggestions resume when the user changes the source/purpose or chooses the suggestion control. Quality specifications and inspection results retain their explicit raw numeric mode because they also support scientific notation; product series remain identifiers so leading zeros are preserved.

Regression coverage includes keystrokes, grouping boundaries, decimal precision, paste validation, live payment requests and mobile purchase draft editing, API payloads, database persistence, reopening and saving unchanged decimal records.

Read-only ERP values now share a string-based formatter across record details, stock choices, transaction controls, history and advanced tables. Database padding is removed (`200.000000` → `200`, `200.125000` → `200,125`, `10.0000` → `10%` for percentage labels). Significant fractional digits are never rounded. UI values consistently use Indonesian separators; formal English ERP PDFs use English separators through the same formatter, including compact tax percentages. Database/API precision and approved Quality/COA result formatting remain unchanged.
