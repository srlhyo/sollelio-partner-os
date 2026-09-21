# UX Specification — Sollelio Partner OS V0

## 1. Experience principles

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

## 3. Partner Home

Priority order:

1. Needs your attention;
2. Since last visit;
3. Recent/important Updates;
4. Quick Resources;
5. Report a problem.

Example content:

- “3 things need your attention · ~12 min total”;
- cards for each Request;
- “Since your last visit: 2 updates · 1 issue resolved”;
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
- clear CTA.

Do not expose IDs, internal priority, lifecycle names or owner metadata.

## 5. Request Detail

Linear structure:

1. title + estimated effort;
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
- add screenshot/image/video.

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

## 10. Resources

Simple canonical access cards, e.g.:

- Sollelio Events;
- Do Luxo à Mesa website;
- shared files.

Only active partner-visible resources should appear.

## 11. Since last visit

Keep as a compact Home block, not a separate page. Prioritize:

1. Needs Partner;
2. important Updates;
3. resolved Issues;
4. other Updates.

Do not show raw chronological activity as the primary return experience.

## 12. Sollelio internal shell

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
- internal notes;
- related objects;
- lifecycle/activity.

## 16. Create Request

Use progressive disclosure. Core inputs:

- person/organization;
- type;
- title;
- why;
- expected action;
- estimated effort;
- product;
- optional due date/media/questions.

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

This separation is important to prevent accidental exposure of internal notes.

## 19. Events V1 embedded experience

Initial embedded capabilities:

- attention indicator;
- What’s New indicator;
- Report Problem.

Badge for attention should represent only actionable partner work. Updates should use a separate indicator.

Contextual Issue reporting should automatically include product/page/entity context where available.

Core Events functionality must remain usable if Partner OS is unavailable.

## 20. Deep links

A partner deep link should survive authentication:

requested URL → login if necessary → return to the exact Request/Update/Issue.

Do not send a user to Home after login and make them search again.

## 21. Loading, empty and error states

Use skeletons where appropriate instead of blank screens.

Error state must preserve unsent partner input where possible. Failed submissions should not erase text/audio metadata before the server confirms success.

## 22. Media/upload UX

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
