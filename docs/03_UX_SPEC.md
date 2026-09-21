# UX Specification — Sollelio Partner OS V0

## 1. Experience principles

### Language

**Both experiences are Portuguese (pt-PT) in V0** — the partner surfaces and the Sollelio internal surfaces. There is no language switcher and no i18n framework; copy is written directly in Portuguese.

Prefer clear, relatively neutral Portuguese: standard pt-PT that a Brazilian reader also understands without friction. Avoid regional idiom and colloquialism on both surfaces. The partner tone is calm and human; the internal tone is direct and operational. Neither is a reason to reach for slang.

Every example string in this document is written in English for specification clarity. **None of them is final copy.** Portuguese runs roughly 20–30% longer than English, so layouts must tolerate that much more text than the examples suggest — particularly buttons, status chips, the attention header, and internal table columns and queue labels, which are the places where density and translation collide.

Internal enum vocabulary (`needs_partner`, `ux_confusion`, and so on) is English domain terminology in the database. It is rendered into Portuguese at the presentation boundary and never shown raw on any surface, internal included.

### Partner

- mobile-first;
- calm, clear, high-trust and lightweight;
- primary question: “What do I need to do now?”;
- no internal operational jargon;
- very few decisions per screen;
- every action has explicit completion feedback;
- no dead ends;
- media used when it reduces cognitive effort;
- partner should not feel like they are managing tickets.

### Sollelio internal

- desktop-first, responsive;
- more information density where it improves operation;
- next responsibility visible;
- partner-facing and internal information visibly separated;
- common triage/actions fast;
- history and origin preserved.

## 2. Partner shell

Primary navigation:

- Home;
- Updates;
- Issues;
- Resources.

On mobile, a compact menu is acceptable; do not force a heavy persistent sidebar. Many visits will arrive through deep links.

### Organization context

V0 assumes the partner belongs to exactly one organization, so there is no organization switcher in the normal experience.

If a partner ever holds more than one active membership, show an explicit chooser before Home. Never pick one silently — a partner acting inside the wrong organization is worse than an extra tap.

## 3. Partner Home

Priority order:

1. Needs your attention;
2. Since last visit (Slice 3);
3. Recent/important Updates;
4. Quick Resources;
5. Report a problem.

### What counts as attention

“Needs your attention” contains exactly two kinds of item:

- Requests where `next_actor = partner`;
- Issues where `status = needs_partner` (we asked the partner a clarifying question).

Nothing else. Updates never appear here, including Updates that require acknowledgement — those live in the Updates indicator. If it is not something the partner must act on, it is not attention.

The **total effort** figure is calculated from Requests only, because Issues carry no effort estimate. Show it only when every counted Request has an estimate; otherwise show the count alone.

The **Since last visit** block ships in Slice 3, alongside Updates. Before that it has nothing real to show, and Home shows attention, Quick Resources and Report a problem only.

Example content:

- “3 things need your attention · ~12 min total”;
- cards for each Request;
- “Since your last visit: 2 updates · 1 issue resolved” (Slice 3);
- short Update cards;
- canonical links;
- persistent Report Problem action.

### Empty state

When no Requests are pending, show a positive human state such as “Everything is handled — nothing needs your attention right now.” Do not show “0 requests”.

## 4. Attention / Request card

Should display only what helps immediate action:

- title;
- short purpose/context if useful;
- product/context label;
- estimated effort;
- deadline, when one exists;
- clear CTA.

### Deadline

When a Request has a deadline, show it in human form — “até sexta”, “até amanhã”, a date when it is further out — on both the card and the detail view. A deadline the partner cannot see is worse than no deadline at all.

When there is no deadline, show **no deadline UI**: no placeholder, no “sem prazo”, no empty slot. Most Requests will have none, and `02_OPERATING_MODEL.md §2` deliberately keeps it that way. The absence of a deadline element is what makes the present ones mean something.

### Effort

Render `<1 min` as “<1 min”, never as “1 min”. The smallest honest estimate should read as trivially small, because that is the point of showing it.

Do not expose IDs, internal priority, lifecycle names or owner metadata.

This is guaranteed structurally, not by discipline: partner surfaces read a partner projection that contains no internal columns. The only state a partner surface receives is a partner-facing state (needs you / with Sollelio / done / cancelled), already translated out of internal lifecycle vocabulary.

## 5. Request Detail

Linear structure:

1. title + estimated effort + deadline when one exists;
2. why Sollelio is asking;
3. exact action;
4. links/media needed to perform it;
5. response controls;
6. submit.

### Submission success

After submit, show explicit confirmation such as:

- “Sent.”
- “We have what we need.”
- “It’s with us now.”

If other Requests remain, the user may continue, but do not immediately redirect without confirmation.

## 6. Approval Request

Show the material first, then two primary actions:

- Approve;
- Needs changes.

Only reveal the change-feedback field after “Needs changes”.

There is one approval mechanism. An approval Request carries a system-generated approval field plus an optional notes field; authors never hand-build approval questions, and this screen always renders from the same known shape.

## 7. Test Request

Structure:

- explain what to test;
- provide deep link/action;
- after the test, ask a very small number of targeted questions;
- if the answer indicates failure/confusion, allow text/audio/media evidence.

## 8. Updates

List should distinguish new from previous updates without creating an infinite feed. Filters are optional until volume requires them.

Update Detail shows:

- update type;
- title;
- product/context;
- concise explanation;
- media if useful;
- why it changed only when useful;
- explicit “No action needed” or a linked Request.

### Important Update

Can require acknowledgement with a simple CTA such as “Understood”. Do not overuse acknowledgement.

## 9. Issues — partner experience

### Issues list

Separate open and resolved Issues. Human status language examples:

- We’re checking;
- We need something from you;
- Resolved.

### Report Issue

First screen should make it easy to report in the partner’s preferred format:

- record audio;
- write;
- add screenshot/image.

V0 supports text, image and audio. Video is deferred — do not offer it.

If opened from an integrated product, do not ask the partner to manually enter context already known by the system.

### Review before submit

Show the human-readable report and obvious context. Hide technical route/version/entity metadata.

### Success state

Confirm receipt and make the next state clear: no action required unless Sollelio asks for more information.

### Issue Detail

Show:

- original report/evidence;
- simple current status;
- partner-visible timeline/messages;
- clarification request when needed;
- partner-facing resolution.

When Sollelio asks a clarifying question, the Issue appears in “Needs your attention” on Home until the partner answers. Answering returns it to “We’re checking”.

### After a resolution

A resolved Issue stays open to reply. If the partner says it is still happening, confirm that the message reached Sollelio — do not claim the Issue has been reopened, because reopening is a Sollelio decision. Something honest and non-committal, such as “Recebemos. Vamos rever.”

Never show the partner an automatic closure countdown. Issues are closed deliberately by Sollelio.

## 10. Resources

Simple canonical access cards, e.g.:

- Sollelio Events;
- Do Luxo à Mesa website;
- shared files.

Only active partner-visible resources should appear. This list is the single source of truth for partner-facing links; superseded URLs never appear as a partner choice.

Opening a Resource is recorded, so the pilot can answer whether canonical links are actually being used. This is invisible to the partner: no counters, no “last opened”, no behaviour change. It is the only partner interaction V0 instruments, and it is deliberately the only one.

## 11. Since last visit

Ships in **Slice 3**, with Updates. It has no real content before then.

Keep as a compact Home block, not a separate page. Prioritize:

1. Needs Partner;
2. important Updates;
3. resolved Issues;
4. other Updates.

Do not show raw chronological activity as the primary return experience.

“Since last visit” compares against the partner’s **previous** visit, not the current one, so opening Home does not immediately empty the block. This requires two stored timestamps per person, rotated on visit (`05_DATA_MODEL_AND_API.md §17`).

## 12. Sollelio internal shell

The internal experience is Portuguese too (§1). Dense operational surfaces are where translation hurts most: queue labels, table headers and status chips carry the longest relative growth. Design them with real Portuguese strings, not English placeholders.

Sidebar/top navigation:

- Overview;
- Organizations;
- Requests;
- Issues;
- Updates;
- Activity.

## 13. Internal Overview

This is a work queue, not a vanity analytics dashboard.

Primary signals:

- Needs Sollelio;
- Needs Partners;
- Open Issues;
- Resolved Issues the partner replied to after resolution;
- Important unseen Updates.

Then show actionable queues and recent reports.

## 14. Organization Detail

Header with organization identity/status, then:

- Needs Partner count;
- Needs Sollelio count;
- Open Issues;
- Important unseen.

Sub-navigation:

- Overview;
- Requests;
- Issues;
- Updates;
- Resources;
- People;
- Activity.

## 15. Internal Request Detail

Display operational metadata, then clearly separate:

### Partner-facing
- title;
- context;
- requested action;
- fields/questions;
- media;
- submitted response.

### Internal-only
- completion criteria;
- internal owner;
- internal priority;
- internal notes;
- related objects;
- lifecycle/activity.

Internal-only content here is not merely styled differently — it comes from a separate internal record that no partner surface can read. “Preview as Partner” is therefore an honest preview: it renders the same projection the partner receives.

## 16. Create Request

Use progressive disclosure. Core inputs:

- person/organization — one named partner person, who must be an active member of that organization;
- type;
- title;
- why;
- expected action;
- estimated effort;
- completion criteria (internal-only — the partner never sees this field);
- product;
- optional due date/media/questions.

Choosing type **approval** generates the approval response automatically. Do not offer the author a way to build approval questions by hand.

Question types available in V0 are long text, single choice, boolean and approval. That is deliberately the set the partner surfaces render; adding a type is a product decision, not an authoring convenience.

Must include **Preview as Partner** before publication.

## 17. Create Update

Core inputs:

- product;
- type;
- title;
- what changed;
- optional why-it-matters;
- media;
- action requirement;
- audience.

If action is required, prompt for creation/linking of a Request.

## 18. Internal Issues

Issue list should optimize scan speed by state: New/Needs triage, Investigating, Needs Partner, Resolved.

Issue Detail zones:

1. Original report and source context;
2. optional AI assistance;
3. triage controls;
4. internal investigation;
5. clearly separated partner-facing message/resolution.

This separation is important to prevent accidental exposure of internal notes. Anything written in the internal zones is stored in internal-only records that no partner projection reads, so the boundary holds even if the UI is wrong.

Resolve, reopen and close are explicit operator actions. When a partner has replied after resolution, surface that prominently on the Issue and in the queue — it is the signal that a resolution may not have worked.

That signal has two exits, and they must not look alike:

- **Reopen** — investigation resumes. The Issue returns to the working queue.
- **Acknowledge** — the reply was read and answered, and nothing needs reinvestigating. The signal clears; the status does not change.

Acknowledge must never be the easier or more prominent of the two, and it must never be reachable without having actually replied to the partner. It exists so a handled follow-up stops nagging the queue, not so an inconvenient one can be dismissed.

Reopening is a decision, never automatic, and closing is never automatic either.

## 19. Events V1 embedded experience

Initial embedded capabilities:

- attention indicator;
- What’s New indicator;
- Report Problem.

The attention badge counts the same two things as Partner Home: Requests where `next_actor = partner`, plus Issues where `status = needs_partner`. Updates use a separate indicator, and acknowledgement-required Updates are counted there, never in attention.

Contextual Issue reporting should automatically include product/page/entity context where available. It supports text, screenshot/image and audio.

Video and screen recording are deferred. Do not design an affordance for them. They arrive only if a real case shows text, image and audio forcing several rounds of clarification because the partner could not show movement.

Core Events functionality must remain usable if Partner OS is unavailable. The indicators are fetched with a short timeout and fail open: if Partner OS does not answer, Events renders without them rather than waiting or showing an error. If Report Problem cannot reach Partner OS, show a human fallback — report by WhatsApp — not a broken button.

## 20. Deep links and sign-in

A partner deep link should survive authentication:

requested URL → login if necessary → return to the exact Request/Update/Issue.

Do not send a user to Home after login and make them search again.

Sign-in is **magic link / email OTP**. There is no password field anywhere in the partner experience. The sign-in screen asks for an email address and then explains clearly what will arrive and what to do with it; the “check your email” state is a designed screen, not a toast. The returning link must carry the original destination through to the final landing page.

Design for the realistic failure cases: the link opening in a different browser than the one that requested it, and an expired link. Both need a calm way back to requesting a new one.

## 21. Loading, empty and error states

Use skeletons where appropriate instead of blank screens.

Error state must preserve unsent partner input where possible. Failed submissions should not erase text/audio metadata before the server confirms success.

## 22. Media/upload UX

Uploads go to short-lived signed URLs issued per file, so an upload can fail because its URL expired while the partner was still recording or writing. Treat that as a retryable state with the input preserved, never as a lost submission.

Show upload progress and success/failure. Audio capture should allow playback/re-record before submission. Video should not autoplay by default. Show duration before playback. Voice videos should have captions when practical.

## 23. Accessibility

V0 requirements:

- keyboard navigation for internal workflows;
- semantic labels/forms;
- visible focus;
- sufficient contrast;
- do not communicate state by color alone;
- reasonable mobile target sizes;
- captions for narrated product-update video where available.

## 24. Responsive priorities

Partner: start design at roughly 375–430 px mobile widths and scale upward.

Internal: optimize first for roughly 1280–1440 px desktop while remaining functional on smaller laptops/tablets.

## 25. Design direction

Partner: calm, premium, warm, high-trust, minimal cognitive load.

Internal: precise, operational, fast, denser where useful.

They should belong to the same Sollelio system without forcing identical density.
