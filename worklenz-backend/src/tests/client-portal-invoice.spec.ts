import {
  calculateInvoiceTotals,
  normalizeInvoiceInput,
} from "../services/client-portal-invoice.service";

describe("client portal invoice calculations", () => {
  it("calculates line items, discounts, and tax from server inputs", () => {
    expect(
      calculateInvoiceTotals(
        [
          { description: "Website build", quantity: 2.5, rate: 100 },
          { description: "Hosting", quantity: 1, rate: 25.55 },
        ],
        "percentage",
        10,
        8.25,
      ),
    ).toEqual({
      items: [
        {
          description: "Website build",
          quantity: 2.5,
          rate: 100,
          amount: 250,
        },
        {
          description: "Hosting",
          quantity: 1,
          rate: 25.55,
          amount: 25.55,
        },
      ],
      subtotal: 275.55,
      discountAmount: 27.56,
      taxAmount: 20.46,
      amount: 268.45,
    });
  });

  it("rounds quantity and currency consistently with database constraints", () => {
    expect(
      calculateInvoiceTotals(
        [{ description: "Fractional work", quantity: 1.2344, rate: 19.999 }],
        "fixed",
        0.01,
        0,
      ),
    ).toMatchObject({
      items: [{ quantity: 1.234, rate: 20, amount: 24.68 }],
      subtotal: 24.68,
      discountAmount: 0.01,
      amount: 24.67,
    });
  });

  it("rejects invalid or zero-value invoices", () => {
    expect(() =>
      calculateInvoiceTotals(
        [{ description: "No charge", quantity: 1, rate: 0 }],
        "none",
        0,
        0,
      ),
    ).toThrow("greater than zero");
    expect(() =>
      calculateInvoiceTotals(
        [{ description: "Service", quantity: 1, rate: 10 }],
        "percentage",
        101,
        0,
      ),
    ).toThrow("cannot exceed 100");
  });

  it("normalizes the public builder contract without trusting browser totals", () => {
    const normalized = normalizeInvoiceInput({
      requestId: "11111111-1111-4111-8111-111111111111",
      currency: "usd",
      amount: 0.01,
      subtotal: 0.01,
      lineItems: [
        {
          description: "Actual source",
          quantity: 2,
          rate: 50,
          amount: 0.01,
        },
      ],
      discountType: "none",
    });
    expect(normalized).not.toHaveProperty("amount");
    expect(normalized.lineItems).toEqual([
      { description: "Actual source", quantity: 2, rate: 50 },
    ]);
  });
});
