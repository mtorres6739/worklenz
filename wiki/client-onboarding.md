# Client onboarding runbook

## Internal pilot

1. Add staff identities to the Cloudflare Access application.
2. Invite staff through Worklenz. Public signup remains closed.
3. Operate for one business week and resolve every severity-1 issue.

## Designated client pilot

1. Complete the isolation acceptance suite and restore drill.
2. Add the client's approved identities to Cloudflare Access.
3. Invite each user to Worklenz as a regular member.
4. Add members only to their assigned project. Never grant owner, admin, or team-lead
   roles to a client.
5. Enable `NEXT_PUBLIC_WORKLENZ_PROJECTS_ENABLED=1` in Kinetic only after the internal
   gate passes. Kinetic performs an external navigation and passes no authentication.
6. Verify the client cannot enumerate or receive events for another project.

All-client onboarding remains blocked until API, report, search, file, and Socket.IO
isolation have automated coverage and the designated pilot is accepted.

## Website delivery projects

For website builds, redesigns, migrations, and relaunches, install
`SDM — Website Pre-Launch QA v2` and follow the dedicated
[website checklist runbook](website-prelaunch-checklist.md). Do not apply this template
to standalone SEO, Google Ads, or Meta Ads projects; those need their own service
templates.
