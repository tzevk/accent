# Project membership and lead policy are separate from explicit scoped grants

Accepted on 2026-11-04. **Implemented by issue #410 on `integration/410-project-permissions`.**

Project Team membership grants project workspace access. Project Lead grants one shared work-editing policy only on led projects. Explicit project permissions add authority with a separate Led, Assigned, or All projects scope for each action. Financial documents and commercial amounts require their own permissions.

We chose relationship-derived access so leads do not need broad Update grants merely to reach their projects. We kept explicit grants additive so project responsibility does not restrict separately authorized management work. Existing Update and Assign grants migrate to All projects to avoid silently removing management access. Administrators must narrow or remove lead-access workaround grants explicitly.

Rejected: using Projects Update as both navigation access and project authority, or silently reinterpreting existing broad grants as lead-only access. The first recreates the reported overreach; the second changes existing management rights without review.

The [approved project permissions design](../app/projects/permissions-design.md) owns the section matrix, team lifecycle, commercial boundary, migration rules, and implementation acceptance scenarios.
