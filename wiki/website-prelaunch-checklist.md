# SDM website pre-launch checklist

## Scope

`SDM — Website Pre-Launch QA v2` is the accountability template for website builds,
redesigns, migrations, and relaunches. It contains six QA section tasks, the exact 29
checks from the approved source, and a three-task client/team sign-off workflow.

Do not use it for standalone SEO, Google Ads, or Meta Ads projects. Create separate,
versioned templates for those services.

## Source and confidentiality

The approved DOCX is confidential and stays in local `sdm_docs/`, which is excluded
from Git. Never commit the DOCX or its database seed payload to the public AGPL fork.
The deployed template content lives in PostgreSQL and encrypted backups.

The stable template key is `sdm-website-prelaunch-v2`. Version 2 becomes immutable
after its first project import. Future edits require a new key and version; never
silently change an active checklist. The lock is stored on the template itself, so it
survives deletion of projects and their import-history rows.

## Install into a project

1. Confirm the project category is Website and the work is a build, redesign,
   migration, or relaunch.
2. Set the project end date to the intended production launch target.
3. Select the accountable project manager or default owner.
4. During project creation, keep the recommended checklist selected. For an existing
   project, use the task-template import drawer.
5. Confirm the destination phase is `Pre-Launch QA` and install.
6. A repeated import is safe and returns the existing import without creating tasks.

The import creates or reuses these statuses: `To Do`, `In Progress`,
`Waiting on Client`, `Ready for Verification`, `Verified`, and `Not Applicable`.
`Verified` and `Not Applicable` are done-category statuses, so a genuinely conditional
item may pass the launch gate when it does not apply.

## Due dates and ownership

- Contact information: launch minus 14 days.
- Analytics, social profiles, and content approval: launch minus 7 days.
- Forms, integrations, legal, and compliance: launch minus 3 days.
- Sign-off: launch minus 1 day.

Every imported task initially belongs to the selected accountable owner. The project
manager may reassign specialist checks after installation without changing the gate.

## Launch gate

The final `Project Manager Authorizes Production Launch` task is blocked by all 29
checks plus `Resolve All Outstanding Items` and `Record Client Approval Evidence`.
It cannot enter a done-category status until all 31 dependencies are either `Verified`
or `Not Applicable`.

`Record Client Approval Evidence` cannot enter a done-category status until it has at
least one task comment or attachment. The comment or attachment must contain or link
the client's written approval. Worklenz activity history is the accountability record;
client access is not required during the internal pilot.

## Release rehearsal

Before applying a new checklist version to an active client project:

1. Take and verify an encrypted backup.
2. Restore a production clone and apply the migration twice.
3. Initialize an empty database and apply all migrations.
4. Create a disposable website project and install the template.
5. Verify 39 total tasks, seven parents, 29 document checks, three sign-off tasks,
   descriptions, four labels, phase, six statuses, owner, offsets, and 31 dependencies.
6. Import again and verify zero additional tasks.
7. Verify final authorization is blocked with an incomplete requirement.
8. Mark a conditional check `Not Applicable` and verify it satisfies the gate.
9. Verify client approval is blocked without evidence and succeeds after a comment or
   attachment.
10. Delete the disposable project only after the checks pass.
