# Agent Spend — UI/Product Pass

## Approved visual direction

- Dark mode is the default.
- Use a lighter premium charcoal/graphite rather than pure black or washed-out gray.
- Keep surfaces clearly interactive; avoid a disabled/grayed-out appearance.
- Use restrained blue for primary actions/selected states and teal for healthy/success states.
- Avoid gradients, neon crypto styling, and excessive card density.
- Desktop navigation is a slim icon dock. Icons gently magnify on hover and reveal a text label. Active state is subtle.
- Mobile navigation becomes a compact bottom navigation treatment.
- Do not hard-code a user's name. Time-aware greetings should use the authenticated user's actual display name only when available.

## Product clarity / onboarding

The first-run experience should immediately explain Agent Spend in plain language:

> Give AI agents controlled spending power without giving them unrestricted wallet access.

The onboarding flow should orient an operator around the core workflow:

1. Connect or configure a Tempo account to watch.
2. Provision an agent access key with an on-chain budget and spending rules.
3. Let the agent transact inside those rules.
4. Monitor payments, remaining budget, recipients, and signed payment reasons.
5. Review budget-increase requests and approve or reject them.
6. Revoke an agent key immediately when access should end.

Empty states should be instructional rather than merely reporting that no data exists. Each empty state should explain what will appear there and the next useful action.

## Overview hierarchy

The overview should answer three questions quickly:

1. What is happening?
2. Does anything need attention?
3. What should I do next?

Prioritize active agents, total spend, payments, pending approvals, low/exhausted budgets, and recent activity. Avoid decorative metrics that do not drive an operator decision.

## Public/SEO content direction

Authenticated dashboard/application routes should remain non-indexable. Public documentation, help, and marketing content may be indexable.

Use natural language around terms people may search for, including:

- AI agent payments
- AI agent spending controls
- autonomous agent payments
- AI agent wallets
- AI agent budgets
- programmable payments for AI agents
- on-chain spending limits
- Tempo payments
- Tempo access keys
- AI agent payment approvals
- agent spend management
- AI financial infrastructure

Do not keyword-stuff. Keywords should appear naturally in page titles, headings, meta descriptions, explanatory copy, and help articles.

Public pages should include sensible page titles, descriptions, canonical URLs when a stable public URL exists, Open Graph metadata, and structured data where appropriate.

## Help content priorities

Initial help content should cover:

- What Agent Spend is
- How agent spending controls work
- How Tempo access keys enforce budgets
- How to provision an agent
- How signed payment reasons work
- How budget requests and approvals work
- How to revoke an agent
- How monitoring works without requiring the agent to use a proprietary tracking SDK
- Security model and operator-key guidance
- Troubleshooting RPC/indexer freshness and unavailable budget reads

## Implementation order

1. Preserve the approved responsive charcoal visual system and icon dock.
2. Add first-run onboarding and instructional empty states.
3. Polish Overview, Activity, Approvals, Keys, and Agent Detail screen hierarchy/copy.
4. Add public help/about content with SEO metadata where it fits the current server architecture.
5. Add noindex metadata to private application/dashboard surfaces.
6. Run type-checking and the full test suite.
7. Review PR visually before merge.

This document records the approved product direction so implementation can proceed without losing the decisions made during UI review.
