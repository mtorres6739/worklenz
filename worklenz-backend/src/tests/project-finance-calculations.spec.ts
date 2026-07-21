import {
  calculateActualLaborCost,
  calculateEstimatedLaborCost,
  calculateFinanceTotals,
  formatFinanceDuration,
} from "../shared/project-finance-calculations";

describe("project finance calculations", () => {
  const rates = [
    { rate: 100, man_day_rate: 700 },
    { rate: 50, man_day_rate: 500 },
  ];

  it("distributes an hourly estimate evenly across assignees", () => {
    expect(calculateEstimatedLaborCost(120, 0, rates, "hourly")).toBe(150);
  });

  it("uses man-day rates for man-day projects", () => {
    expect(calculateEstimatedLaborCost(0, 2, rates, "man_days")).toBe(1200);
  });

  it("does not invent a labor budget for unassigned tasks", () => {
    expect(calculateEstimatedLaborCost(120, 0, [], "hourly")).toBe(0);
  });

  it("selects the immutable snapshot cost for the active method", () => {
    expect(calculateActualLaborCost(7200, 210.25, 1500.5, "hourly")).toBe(
      210.25,
    );
    expect(calculateActualLaborCost(7200, 210.25, 1500.5, "man_days")).toBe(
      1500.5,
    );
  });

  it("calculates budget, actual and under-budget variance", () => {
    expect(calculateFinanceTotals(1000, 800, 50)).toEqual({
      totalBudget: 1050,
      totalActual: 850,
      variance: 200,
    });
  });

  it("reports an over-budget project with negative variance", () => {
    expect(calculateFinanceTotals(500, 650, 25)).toEqual({
      totalBudget: 525,
      totalActual: 675,
      variance: -150,
    });
  });

  it("excludes non-billable work when the caller omits it from the selected fixture", () => {
    const selectedBillableRates = rates.filter((_rate, index) => index === 0);
    expect(
      calculateEstimatedLaborCost(60, 0, selectedBillableRates, "hourly"),
    ).toBe(100);
  });

  it("formats durations for the public frontend contract", () => {
    expect(formatFinanceDuration(3672)).toBe("1h 1m 12s");
  });
});
