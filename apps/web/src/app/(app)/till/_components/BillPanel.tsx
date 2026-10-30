"use client";

import type { BillAction, BillState } from "@/client/pos/bill";
import { stockLabel } from "@/client/pos/scanResult";
import { formatMinor, type SaleTotals } from "@/server/sales/saleTotals";
import { Button, Chip, Panel } from "./primitives";

/**
 * The bill on screen — the largest, highest-contrast thing on the till, because it is what
 * both the cashier and the customer are actually looking at.
 *
 * Every figure here is a preview. The unit prices came from the server with the scan, the
 * totals are computed by the same pure function the sale transaction uses, and all of it is
 * discarded the moment the server answers with the real sale. The screen never decides what a
 * customer is charged; it predicts it, accurately, and then defers.
 *
 * No money is calculated in this file, and that is the point rather than an accident. The rows
 * are drawn from the computed lines, so a change to how a line total is worked out reaches this
 * screen by changing one function — not by changing one function and hoping the copy in the UI
 * was noticed. A second expression here would be correct on the day it was written and wrong on
 * the day tax, rounding or discount rules moved.
 *
 * Quantity editing is deliberately coarse and physical: large plus and minus targets, and a
 * number field for the case where a cashier knows the count. Stepping below one removes the
 * line, which is what pressing minus on a single item means.
 */

export function BillPanel({
  bill,
  totals,
  dispatch,
  readOnly,
}: {
  bill: BillState;
  totals: SaleTotals;
  dispatch: (action: BillAction) => void;
  /** True while a sale is in flight or finished — the bill is no longer the operator's to change. */
  readOnly: boolean;
}) {
  return (
    <Panel
      title={`Current bill${bill.lines.length > 0 ? ` · ${bill.lines.length} line${bill.lines.length === 1 ? "" : "s"}` : ""}`}
      className="min-h-0 flex-1"
    >
      {bill.lines.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 py-16 text-center">
          <p className="text-base font-semibold text-amb-ink">Nothing on this bill yet</p>
          <p className="max-w-sm text-sm text-amb-ink-muted">
            Scan an item to begin. The bill builds as you go and nothing is charged until you
            take payment.
          </p>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <table className="w-full border-collapse">
            <caption className="sr-only">Items on the current bill</caption>
            <thead className="sticky top-0 bg-amb-raised">
              <tr className="border-b border-amb-line text-left">
                <th scope="col" className="px-4 py-2 text-xs font-semibold uppercase tracking-wider text-amb-ink-muted">
                  Item
                </th>
                <th scope="col" className="px-4 py-2 text-xs font-semibold uppercase tracking-wider text-amb-ink-muted">
                  Quantity
                </th>
                <th scope="col" className="px-4 py-2 text-right text-xs font-semibold uppercase tracking-wider text-amb-ink-muted">
                  Line total
                </th>
                <th scope="col" className="px-4 py-2">
                  <span className="sr-only">Remove</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {/* Iterating the computed lines rather than the bill's is what removes the last
                  place a total could be derived twice. Every figure in a row — quantity, unit
                  price, line total — is read from `computeSaleTotals`, the same function the
                  sale transaction uses; the bill is consulted only for the words beside them. */}
              {totals.lines.map((computed) => {
                const line = bill.lines.find((entry) => entry.variantId === computed.variantId);
                // Presentation metadata only. A row with no name to put on it cannot be drawn,
                // and there is deliberately no arithmetic to fall back to.
                if (!line) return null;
                return (
                  <tr key={computed.variantId} className="border-b border-amb-line last:border-0">
                    <td className="px-4 py-3 align-top">
                      <p className="text-sm font-semibold text-amb-ink">{line.productName}</p>
                      <p className="text-xs text-amb-ink-muted">
                        {line.sku}
                        {line.size ? ` · ${line.size}` : ""}
                        {line.colour ? ` · ${line.colour}` : ""}
                      </p>
                      <p className="mt-1 flex items-center gap-2 text-xs text-amb-ink-secondary">
                        <span className="amb-tnum">{formatMinor(computed.unitPriceMinor)} each</span>
                        {/* Never rendered as "0 in stock" when the store has never counted it —
                            those are different facts and a cashier acts on them differently. */}
                        <Chip tone={line.stockQuantity === null ? "neutral" : "info"}>
                          {stockLabel(line.stockQuantity)}
                        </Chip>
                      </p>
                    </td>
                    <td className="px-4 py-3 align-top">
                      <div className="flex items-center gap-1.5">
                        <Button
                          tone="neutral"
                          onClick={() =>
                            dispatch({ type: "quantity_step", variantId: line.variantId, by: -1 })
                          }
                          disabled={readOnly}
                          aria-label={`Reduce quantity of ${line.productName}`}
                          className="w-11 px-0"
                        >
                          −
                        </Button>
                        <label className="sr-only" htmlFor={`qty-${line.variantId}`}>
                          Quantity of {line.productName}
                        </label>
                        <input
                          id={`qty-${line.variantId}`}
                          type="number"
                          min={1}
                          value={computed.quantity}
                          disabled={readOnly}
                          onChange={(event) =>
                            dispatch({
                              type: "quantity_set",
                              variantId: line.variantId,
                              quantity: Number(event.target.value),
                            })
                          }
                          className="amb-tnum h-11 w-16 rounded-amb border border-amb-line-strong bg-amb-raised text-center text-base font-semibold text-amb-ink"
                        />
                        <Button
                          tone="neutral"
                          onClick={() =>
                            dispatch({ type: "quantity_step", variantId: line.variantId, by: 1 })
                          }
                          disabled={readOnly}
                          aria-label={`Increase quantity of ${line.productName}`}
                          className="w-11 px-0"
                        >
                          +
                        </Button>
                      </div>
                    </td>
                    <td className="amb-tnum px-4 py-3 text-right align-top text-base font-semibold text-amb-ink">
                      {formatMinor(computed.lineTotalMinor)}
                    </td>
                    <td className="px-4 py-3 text-right align-top">
                      <Button
                        tone="ghost"
                        onClick={() => dispatch({ type: "line_removed", variantId: line.variantId })}
                        disabled={readOnly}
                        aria-label={`Remove ${line.productName} from the bill`}
                        className="min-h-11 min-w-11"
                      >
                        Remove
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}
