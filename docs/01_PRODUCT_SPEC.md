# Product Specification — Sollelio Partner OS V0

## 1. Problem

Sollelio currently collaborates through channels such as WhatsApp, PDFs, shared files, product links and ad hoc conversations. This creates recurring operational problems:

- messages are missed or buried;
- documents are not always read;
- requests are forgotten;
- there is no immediate view of what is pending from whom;
- feedback, decisions and conversation are mixed together;
- changes to products or websites are not consistently understood;
- bugs and inconsistencies may be reported by audio or in the wrong group;
- reported problems may turn out to be UX confusion, expected behaviour, stale URLs, data issues or feature requests rather than technical bugs;
- follow-up depends too much on Hélio remembering;
- partners may continue using old URLs or old mental models after a change;
- important learning from partner interaction is difficult to trace back to product decisions.

## 2. Product definition

**Sollelio Partner OS V0** is a Sollelio-owned web application with:

1. a very simple partner-facing experience;
2. a richer internal Sollelio operations experience;
3. contextual integrations into Sollelio products such as Sollelio Events V1.

It is a central operating system, not a feature owned by Events V1. Products integrate with Partner OS; Partner OS does not live inside a single product.

## 3. Primary jobs-to-be-done

### Partner

When collaborating with Sollelio, the partner should immediately understand:

- what needs attention now;
- why it matters;
- how long it should take;
- where to act;
- whether a response is required;
- what happens after submission;
- what changed recently;
- how to report a problem with minimal effort;
- what happened to problems already reported;
- which links and resources are canonical.

### Sollelio

Sollelio should be able to:

- know what is waiting on the partner;
- know what is waiting on Sollelio;
- create clear collaboration requests;
- communicate product changes without relying on long PDFs or WhatsApp explanations;
- receive, classify and resolve issues;
- preserve raw evidence and partner responses;
- distinguish bug, UX confusion, data issue, feature request, expected behaviour and stale context;
- close loops visibly;
- preserve useful history;
- identify repeated patterns across partners over time.

## 4. Personas / roles

### Sollelio staff/admin

Can create and manage organizations, products, resources, Requests, Updates and Issues; operate lifecycle transitions; add internal context; review partner responses; triage issues; publish partner-facing resolution; inspect activity; and manage integrations.

### Partner member

Can see relevant Requests, respond to them, view Updates, acknowledge important Updates when required, report Issues, add clarification/evidence, track resolution, and open canonical Resources.

V0 deliberately avoids complex RBAC.

## 5. Core concepts

### Request

Meaning: **“We need you to do something.”**

Types:
- review;
- approval;
- question;
- test;
- task.

Internal lifecycle:
- draft;
- needs_partner;
- in_progress;
- needs_sollelio;
- blocked;
- completed;
- cancelled.

Every open Request has a clear next actor. “Overdue” is a calculated condition, not a state.

A published Request must make clear:
- what to do;
- why;
- estimated effort;
- how to do it;
- completion criteria;
- next step.

### Update

Meaning: **“Something changed and you may need to know.”**

Types:
- new;
- improved;
- fixed;
- changed;
- important_notice.

Impact:
- no_action;
- action_recommended;
- action_required.

If an Update requires action, that action should be represented by a related Request rather than hidden inside the Update.

Per-user receipt states:
- unseen;
- seen;
- acknowledged.

### Issue

Meaning: **“Something may be wrong, unexpected or confusing.”**

An Issue always starts as an observation, not automatically as a bug.

Lifecycle:
- reported;
- triaging;
- investigating;
- needs_partner;
- resolved;
- closed.

Classification:
- unknown;
- bug;
- ux_confusion;
- data_issue;
- feature_request;
- expected_behaviour;
- outdated_url_or_version;
- already_resolved;
- other.

## 6. Supporting concepts

### Organization

A partner organization, initially Do Luxo à Mesa.

### Person

A human user associated with Sollelio or an organization.

### Product

A Sollelio product or managed digital surface relevant to partner work, e.g. Sollelio Events V1 or the Do Luxo à Mesa website.

### Resource

A canonical active link/reference such as the current Events URL, current website, shared file folder or prototype.

### Activity

Operational history such as creation, publication, view, submission, acknowledgement, classification and resolution events.

## 7. Partner/internal boundary

Partner-visible information must be intentionally exposed. Internal information is private by default.

Partners should not see internal priority, triage notes, engineering diagnostics, internal owner notes, hypotheses, other organizations, private AI analysis or technical root-cause detail unless converted into appropriate partner-facing communication.

The partner reports an experience. Sollelio operates the Issue.

## 8. Partner information architecture

Primary surfaces:

- Home;
- Request Detail;
- Updates;
- Update Detail;
- Issues;
- Issue Detail;
- Report Issue;
- Resources.

Home priority:
1. Needs your attention;
2. Since last visit;
3. What’s new;
4. Quick resources;
5. Report a problem.

## 9. Internal information architecture

Primary surfaces:

- Overview;
- Organizations;
- Organization Detail;
- Requests;
- Request Detail;
- Issues;
- Issue Detail;
- Updates;
- Update Editor;
- Activity.

Organization Detail contains:
- Overview;
- Requests;
- Issues;
- Updates;
- Resources;
- People;
- Activity.

## 10. Critical workflows

### Request

Create → Draft → Publish → Needs Partner → Partner submits → Needs Sollelio → review → Completed or returned to Partner with a precise next action.

### Update

Create → Publish → Seen. If action is required, link/create a Request.

### Issue

Partner reports → Reported → Triage → classification → investigation or clarification → partner-facing resolution → Resolved → Closed.

### Important change

Canonical Resource changes → old resource becomes superseded → important Update → partner acknowledgement where needed.

### WhatsApp fallback

If meaningful work starts in WhatsApp, capture it in Partner OS. Do not force the partner to repeat information already supplied.

## 11. Product communication

Use the lowest-effort format that communicates correctly:

- trivial change → 1–2 lines;
- visual change → screenshot;
- interaction change → GIF/micro-video;
- new flow → short walkthrough;
- complex/important change → concise written summary plus media.

Micro-videos are a hypothesis to validate, not a mandatory format.

## 12. Notifications

Partner OS is the source of truth. WhatsApp is a human conversation and attention channel, not the system of record.

Notification levels:

1. Action required — notify strongly; may justify WhatsApp.
2. Important information — may justify WhatsApp, explicitly say no action if none is required.
3. Normal update — usually visible in Partner OS only.
4. Internal activity — never notify the partner.

## 13. V0 non-goals

Partner OS V0 is not:

- a WhatsApp replacement;
- a Slack replacement;
- a Jira replacement;
- a generic project-management system;
- a CRM;
- a knowledge-management suite;
- a roadmap product;
- a full customer-support suite;
- an analytics platform;
- a general-purpose form builder;
- a video-generation platform.

Not in initial V0:

- complex RBAC;
- automated WhatsApp delivery;
- autonomous AI triage;
- autonomous issue closure;
- native AI video generation;
- Decision, Insight or Meeting as first-class entities;
- universal Sollelio SSO migration;
- global search;
- advanced analytics.

## 14. Success criteria

### Partner

- can understand pending work without asking in WhatsApp;
- uses canonical links;
- understands important product changes more reliably;
- can report and track problems;
- increasingly uses contextual issue reporting when convenient;
- receives less irrelevant information.

### Sollelio

- follow-up no longer depends mainly on memory;
- Needs Sollelio and Needs Partner are immediately visible;
- issues no longer disappear inside chats or voice notes;
- observations are triaged rather than prematurely treated as bugs;
- product communication becomes faster and clearer;
- important interaction history is preserved.

### Product learning

- feedback can be linked to changes;
- repeated UX confusion/issues become visible;
- the team learns which communication formats work;
- V0 usage supplies evidence for V1 rather than assumptions.

## 15. V0 → V1 trigger

Move beyond V0 after real use across approximately 2–3 Design Partner organizations, multiple Request/Update/Issue cycles, and observed repeated limitations that justify redesign or additional first-class objects.
