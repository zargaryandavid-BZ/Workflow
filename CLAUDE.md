# CLAUDE.md

All project documentation is in **[docs/DOCUMENTATION.md](docs/DOCUMENTATION.md)**.

Read that file first. Start with [Project overview](docs/DOCUMENTATION.md#project-overview), then use the table of contents for architecture, database, API, components, workflows, deployment, and known issues.

Bazaar (Admin) writes **[docs/bazaar-inbox.md](docs/bazaar-inbox.md)**. Handshake contract: **[docs/workflow-bazaar-connect.md](docs/workflow-bazaar-connect.md)**. Agents: always-apply rule `.cursor/rules/bazaar-agent-inbox.mdc` — implement **Open** items, then move them to **Done**. Inbox hook: `.cursor/hooks.json` (`sessionStart` + `stop`).
