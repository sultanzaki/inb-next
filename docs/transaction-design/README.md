# Transaction and warehouse presentation

- ERP, growth, finance/service and operations details share a record overview with available identity, party, status, date, amount, line count and location. Monetary values use existing formatting and stored totals; presentation does not recalculate posted transactions.
- Document journeys group the existing authorized flow response into sales/purchase, goods movement, billing and payment. Multiple documents remain separate. A visible record does not mean its stage is completed; unavailable/unlinked stages are not treated as blockers. Navigation opens the selected record in the same tab.
- ERP and operations forms have a collapsible live context summary. Desktop places it beside the fields; mobile starts collapsed. Existing field validation, calculations, guided steps and save controls remain authoritative.
- Tables retain column controls, exports and pagination, with consistent numeric alignment, identity emphasis and focus highlighting.
- Warehouses, locations and pallets offer a visual overview using the same current page, search and filters as the table. Cards open existing details. Counts explicitly describe the current page, not all company inventory. This is a location/card view, not a physical floor plan or a capacity estimate.

No schema or business-rule changes. No new data requests are needed for summaries or warehouse cards. Existing document flow reads remain unchanged.

Targeted browser coverage: linked SO/quotation navigation; warehouse card interaction; detail/board overflow at 1440, 390 and 320px; desktop summary columns and collapsed mobile summaries. Review captures include a dark mobile pallet detail. Draft recovery and guided form regression use the existing operator workflow browser suite.
