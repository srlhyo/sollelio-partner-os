# Operating Model — Sollelio Partner OS V0

## 1. Classification rule

Before acting on new operational information, classify it:

- partner must do something → **Request**;
- partner needs to know something changed → **Update**;
- something may be wrong/confusing → **Issue**;
- only Sollelio needs it → internal-only context.

## 2. Request rules

A Request exists only when there is a concrete action expected from the partner.

Every Request should answer:

- What should you do?
- Why are we asking?
- How long should it take?
- Where should you do it?
- What does done mean?
- What happens after you submit?

Avoid “see this when you can”. Prefer precise actions.

Requests should usually be small enough to act on without significant planning. Do not split work artificially, but do not hide multiple unrelated decisions inside one Request.

Estimated effort should use honest human-scale approximations such as `<1 min`, `~2 min`, `~5 min`, `~10 min`, `~15 min`.

Only add deadlines when they correspond to real dependencies, launches, meetings, events or expiry of usefulness.

## 3. Next actor rule

Every open Request has one unambiguous next actor:

- Partner;
- Sollelio;
- None.

`Needs Partner` is valid only if a specific partner action is visible. `Needs Sollelio` is valid only if the internal next action is understood.

## 4. Definition of done

Each Request must have completion criteria. Conversation does not equal completion. Explicit state does.

A Request can move repeatedly between partner and Sollelio when necessary, but it should return to the partner only with a clear new question or action.

## 5. Update rules

Create an Update when a visible or operationally meaningful change should be communicated, including:

- new user-facing capability;
- meaningful improvement;
- reported problem fixed;
- changed workflow;
- canonical URL/resource changed;
- important notice that prevents confusion.

Do not create partner Updates for invisible refactors, dependency upgrades, database maintenance or similar internal work unless they affect the partner.

An Update informs. A Request asks.

## 6. Communication format rule

Choose the format with the lowest cognitive effort that still communicates correctly:

- text for simple facts;
- screenshot for a visual change;
- micro-video/GIF for movement or interaction;
- short walkthrough for a changed workflow;
- longer document only when a document genuinely adds value.

Default micro-video duration: roughly 10–30 seconds. It should explain what changed, where, and what the viewer should understand.

Video production remains external during initial V0 validation.

## 7. Issue rules

Every report begins as an observation. Do not immediately call it a bug.

Sollelio performs triage and classifies the Issue as bug, UX confusion, data issue, feature request, expected behaviour, outdated URL/version, already resolved or other.

If something is technically working but a partner reasonably believed it was broken, preserve the UX signal. “Not a bug” does not mean “not useful feedback”.

## 8. Clarification rule

Do not ask vague questions such as “can you explain better?”. Ask for the smallest missing piece of information required to proceed, e.g.:

- Which event did this happen in?
- Can you send a screenshot of this section?
- Did this happen before or after you saved?

## 9. WhatsApp protocol

WhatsApp remains appropriate for:

- human conversation;
- attention/notifications;
- gentle reminders;
- real urgency;
- temporary capture while behaviour migrates.

WhatsApp is not authoritative storage for:

- task status;
- issue tracking;
- release history;
- structured feedback;
- product decisions;
- canonical links.

If work originates in WhatsApp, capture it in Partner OS. Do not make the partner repeat information already supplied.

## 10. Notification protocol

Every partner communication should make one of these intentions obvious:

- **I need something from you.**
- **You only need to know this.**
- **We have already dealt with this.**

Group low-importance items rather than creating notification spam.

Urgent operational incidents may justify immediate WhatsApp communication plus an authoritative Partner OS record.

## 11. Canonical resources

The Partner OS should expose one active canonical access point for each relevant resource. Previous URLs may remain in internal history but should not be offered as normal partner choices.

When a canonical resource changes:

1. mark the old resource superseded;
2. expose the new active resource;
3. publish an Important Update if partner behaviour may be affected;
4. require acknowledgement only when genuinely important.

## 12. AI rules

AI may assist with:

- transcription;
- summarisation;
- classification suggestions;
- drafting concise partner-facing copy;
- extracting proposed next steps.

AI must not autonomously:

- close Issues;
- declare reports invalid;
- make product commitments;
- publish important Updates;
- make product decisions.

Original evidence is authoritative. AI output is derived assistance.

## 13. Decisions in V0

Decision is not initially a standalone entity. Important decisions should be stored as outcomes attached to the Request, Issue or Update that produced them.

Promote Decision to a first-class entity only when decisions repeatedly span multiple objects or become difficult to retrieve and reason about.

## 14. Meetings in V0

Meeting is not initially a first-class entity. After a meeting:

- actionable partner work → Request;
- observed problem → Issue;
- meaningful change → Update;
- internal reasoning → internal context.

The meeting must not be the only place a consequential action or decision exists.

## 15. Weekly hygiene

Sollelio should periodically review:

- untriaged Issues;
- Needs Sollelio Requests;
- old Needs Partner Requests;
- important unseen Updates;
- incorrect/stale Resources;
- open items that should be completed or cancelled.

The review should remain lightweight. If system maintenance becomes burdensome, simplify the system.

## 16. Operating principle

The Partner OS exists to reduce coordination cost. If it creates more administration than it removes, the model is too heavy and should be simplified.
