# Project finance

Project finance is available only to workspace owners/admins and project managers.
Team leads do not receive financial access merely from their team role. Every query is
scoped to the active team and selected project.

## Model and formulas

- Hourly estimated labor is task estimated hours multiplied by the average assigned
  project rate. This is equivalent to distributing the estimate equally among assignees.
- Man-day estimated labor uses task estimated man-days and assigned man-day rates.
- Actual labor uses each work-log duration and the immutable rate snapshot captured
  when that work log is created.
- Fixed costs can be entered only on leaf tasks, preventing parent/child duplication.
- Parent rows aggregate their complete descendant tree and ignore the parent's own
  estimate, matching the frontend hierarchy model without double counting.
- Budget is estimated labor plus fixed cost. Actual is logged labor plus fixed cost.
  Positive variance means under budget.
- Changing a rate never rewrites prior work-log costs. The initial migration backfills
  historical logs with the rate current at migration time and records that limitation
  in the schema comment.
- When no explicit member override is selected, a new work log snapshots the project
  role matching the member's job title.

Rate-card and finance endpoints live at `/api/v1/ratecard`,
`/api/v1/project-ratecard`, and `/api/v1/project-finance`. Export uses an authenticated
Excel response and the same filters/calculation path as the on-screen table.

## Release procedure

1. Run backend CE typechecking and focused calculation tests.
2. Build the CE frontend with every Sentry upload variable unset.
3. Run the additive migration twice with `rehearse-migration.sh` against an isolated
   encrypted-backup restore clone.
4. Confirm fresh-install CI captures a work-log rate snapshot.
5. Deploy immutable commit-SHA images and run functional/finance smoke tests.

The migration down action intentionally preserves the additive finance schema and
historical snapshots, allowing an older application image to run without deleting
financial history.

The 2026-07-21 migration rehearsal restored the latest encrypted production backup into
an isolated PostgreSQL container and applied the reviewed finance migration twice. The
second run was a no-op and the finance tables, columns, constraints, and snapshot trigger
were present. No production database connection was used.

Production release `21fbc6a049a1448164db21e68952b2901d31adac` applied migration
`2026072100000_self-hosted-finance` on 2026-07-21. Live read-only verification confirmed
the migration record, rate-card and snapshot tables, and snapshot trigger. An
authenticated owner request returned the production rate-card collection successfully.
