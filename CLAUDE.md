# Sollelio Partner OS — Claude Code Instructions

Read `/docs/00_README.md` before making product, architecture, data-model, UX, or implementation decisions.

## Critical rules

- Implement only the active delivery slice.
- Do not expand product scope without an explicit product decision.
- The Partner OS is a Sollelio-wide system, not a feature owned by Sollelio Events V1.
- Sollelio Events V1 must remain operational if Partner OS is unavailable.
- Do not create direct cross-product database coupling.
- Partner-visible and Sollelio-internal data are separate security boundaries.
- Enforce organization isolation server-side and with database authorization/RLS where applicable.
- Never expose service-role credentials or equivalent privileged secrets to the client.
- Preserve original partner submissions, issue evidence, and meaningful lifecycle history.
- Prefer explicit domain workflows over arbitrary client-side row updates.
- Prefer the simplest domain-specific implementation that satisfies the current slice.
- Do not introduce microservices, message brokers, event sourcing, complex RBAC, or generic frameworks without an observed need.
- AI is assistive in V0. Do not allow AI to autonomously close issues, make product decisions, or publish important partner communications.
- Do not recreate WhatsApp, Jira, Slack, a CRM, or a general-purpose project-management suite.
- If implementation evidence requires a product or architecture change, update the canonical documentation before diverging in code.

## Product principle

The Partner experience must answer, with minimal cognitive effort: **What do I need to do now?**

The Sollelio experience must answer: **What is waiting on the partner, what is waiting on Sollelio, and what happened next?**
