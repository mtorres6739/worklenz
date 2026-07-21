export type FinanceCalculationMethod = "hourly" | "man_days";

export interface FinanceRate {
  rate: number;
  man_day_rate: number;
}

export function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function calculateEstimatedLaborCost(
  totalMinutes: number,
  estimatedManDays: number,
  assigneeRates: FinanceRate[],
  method: FinanceCalculationMethod,
): number {
  if (!assigneeRates.length) return 0;
  const averageRate =
    assigneeRates.reduce(
      (total, item) =>
        total + (method === "man_days" ? item.man_day_rate : item.rate),
      0,
    ) / assigneeRates.length;
  const units = method === "man_days" ? estimatedManDays : totalMinutes / 60;
  return roundMoney(Math.max(0, units) * averageRate);
}

export function calculateActualLaborCost(
  loggedSeconds: number,
  hourlyCost: number,
  manDayCost: number,
  method: FinanceCalculationMethod,
): number {
  if (loggedSeconds <= 0) return 0;
  return roundMoney(method === "man_days" ? manDayCost : hourlyCost);
}

export function calculateFinanceTotals(
  estimatedLabor: number,
  actualLabor: number,
  fixedCost: number,
) {
  const totalBudget = roundMoney(estimatedLabor + fixedCost);
  const totalActual = roundMoney(actualLabor + fixedCost);
  return {
    totalBudget,
    totalActual,
    variance: roundMoney(totalBudget - totalActual),
  };
}

export function formatFinanceDuration(seconds: number): string {
  const safeSeconds = Math.max(0, Math.round(seconds));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const remainder = safeSeconds % 60;
  return `${hours}h ${minutes}m ${remainder}s`;
}
