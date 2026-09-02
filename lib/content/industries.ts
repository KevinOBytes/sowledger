export type IndustryWorkflow = { stage: string; detail: string };
export type IndustryFaq = { question: string; answer: string };

export type IndustryContent = {
  slug: string;
  name: string;
  category: string;
  heroLabel: string;
  heroHeadline: string;
  heroSubhead: string;
  workflowHeadline: string;
  workflowSubhead: string;
  challenges: string[];
  workflow: IndustryWorkflow[];
  proofOutputs: string[];
  faqs: IndustryFaq[];
};

type IndustrySeed = Omit<IndustryContent, "workflow" | "proofOutputs"> & {
  work: [string, string, string, string, string, string];
  proof: [string, string, string, string];
};

const workflowStages = ["Plan", "Track", "Log", "Review", "Approve", "Export"] as const;

const industrySeeds: IndustrySeed[] = [
  {
    slug: "freelance-developers", name: "Freelance Developers", category: "Independent technical delivery",
    heroLabel: "Proof-backed billing for freelance developers", heroHeadline: "Recover unbilled engineering time.",
    heroSubhead: "Keep discovery, implementation, debugging, and handoff time in one client-ready work record—without promising automatic code-repository sync.",
    workflowHeadline: "A technical engagement ends with a clear billing story.", workflowSubhead: "Plan the scope, capture live work and manual follow-up, then send a reviewable record with the invoice.",
    challenges: ["Discovery, debugging, and deployment follow-up often disappear between tickets.", "Small support requests can interrupt a focused build without becoming billable work.", "Clients need context for a technical invoice without access to your internal workspace."],
    work: ["Block sprint goals, technical discovery, and launch tasks against the project.", "Run a live timer while building, debugging, or walking a client through a decision.", "Add manual entries for incident follow-up, release notes, and asynchronous support.", "Compare planned and actual hours before a fixed-scope or retainer check-in.", "Share an approval-ready proof packet with the client before invoicing.", "Send CSV or JSON records with digest headers, or use scoped API keys and webhooks."],
    proof: ["Project-level planned-versus-actual hours", "Timer, manual, and calendar source mix", "Client-safe approval trail and invoice context", "Digest-backed CSV or JSON export"],
    faqs: [{ question: "Does SOWLedger read my GitHub or pull requests?", answer: "No. Track engineering time through planning, timers, calendar blocks, and manual entries; connect your own systems through scoped API keys and webhooks where appropriate." }, { question: "Can I show a client why an invoice changed?", answer: "Yes. Review the work record before invoicing, then provide planned-versus-actual context, source mix, and approval history in a proof packet." }, { question: "Is it useful for small support retainers?", answer: "Yes. Short support and follow-up work can be logged as it happens, reviewed against the retainer, and exported or approved with the rest of the engagement." }],
  },
  {
    slug: "marketing-agencies", name: "Marketing Agencies", category: "Multi-client campaign delivery",
    heroLabel: "Proof-backed billing for marketing agencies", heroHeadline: "Keep retainers connected to real campaign work.",
    heroSubhead: "Give account leads a complete record of planning, production, meetings, and client approvals before the monthly billing conversation.",
    workflowHeadline: "Campaign delivery has a work record your client can follow.", workflowSubhead: "Bring planned effort, active work, corrections, sign-off, and exports into a single agency operating rhythm.",
    challenges: ["Strategy, coordination, and reporting time get spread across many client touchpoints.", "Concurrent campaigns make it difficult to spot work drifting beyond the retainer.", "Account teams need an approval path that does not expose internal planning."],
    work: ["Map campaign phases, production blocks, and client meetings to the account.", "Track live creative, account-management, and optimization sessions.", "Record manual follow-up, reporting, and client-request work that happens off the timer.", "Use analytics to compare campaign plans, actuals, and billable output.", "Present client-safe proof for sign-off before the monthly invoice.", "Export evidence or send project, time, invoice, and approval events through webhooks."],
    proof: ["Campaign planned-versus-actual view", "Billable output across live, manual, and calendar work", "Client approval context for each proof packet", "CSV/JSON account export with SHA-256 digest header"],
    faqs: [{ question: "Can account managers review a retainer before billing?", answer: "Yes. Analytics make planned versus actual work and billable output available for review before the invoice is issued." }, { question: "Can a client approve work without seeing internal operations?", answer: "Yes. The client sign-off flow is designed for focused proof packets rather than workspace planning, timers, or settings." }, { question: "Can we move records to another agency system?", answer: "Yes. Use digest-backed CSV/JSON exports or scoped API keys and webhooks for the data your process needs." }],
  },
  {
    slug: "seo-consultants", name: "SEO Consultants", category: "Search strategy and technical analysis",
    heroLabel: "Proof-backed billing for SEO consultants", heroHeadline: "Make research and recommendations billable work.",
    heroSubhead: "Capture audit time, stakeholder calls, analysis, and implementation guidance in a record that explains the work behind each engagement.",
    workflowHeadline: "SEO work stays visible from audit to client handoff.", workflowSubhead: "Plan research cycles, log the work that sits between meetings, and hand off a reviewable billing record.",
    challenges: ["Deep technical analysis is easy to undercount when it happens between deliverables.", "Recurring calls, research, and reporting can blur together across retainers.", "A client may see recommendations but not the investigation that produced them."],
    work: ["Schedule audits, research sprints, reporting cycles, and stakeholder reviews.", "Run timers during analysis, technical reviews, and working sessions.", "Add manual time for annotation, recommendation writing, and asynchronous questions.", "Compare the planned audit or retainer workload with completed time.", "Use a client-safe proof packet to align on the work before invoicing.", "Export a digest-backed record for client files or downstream reporting."],
    proof: ["Audit and research hours by project", "Calendar, timer, and manual work source mix", "Reviewable retainer workload before invoice issue", "Client-ready proof packet and export"],
    faqs: [{ question: "Can I log research that is not tied to a meeting?", answer: "Yes. Use a timer while researching or add a manual entry when the work is complete." }, { question: "Does SOWLedger replace SEO tools?", answer: "No. It is the work and billing record around your SEO process, with exports and API/webhook options for connecting other systems." }, { question: "Can recurring SEO retainers be reviewed monthly?", answer: "Yes. Plan recurring work, compare actuals, and use the approval and proof flow before the monthly invoice." }],
  },
  {
    slug: "graphic-designers", name: "Graphic Designers", category: "Creative production",
    heroLabel: "Proof-backed billing for graphic designers", heroHeadline: "Keep revisions from becoming invisible work.",
    heroSubhead: "Track concepting, production, feedback rounds, and handoff time so your client sees the work behind the finished design.",
    workflowHeadline: "Creative work gets a clean path from brief to proof.", workflowSubhead: "Make production blocks and out-of-band revisions visible before the next approval or invoice.",
    challenges: ["Concept exploration and revision rounds can exceed the original estimate quietly.", "Small stakeholder changes interrupt production without landing in a timesheet.", "Design clients need clarity on effort without access to your internal creative process."],
    work: ["Set design phases, review windows, and production blocks for each client project.", "Track focused concepting, layout, and production sessions with a live timer.", "Capture manual entries for feedback consolidation and quick revision requests.", "Compare planned design time with actual effort before scope or billing discussions.", "Hand clients a focused record for sign-off without revealing internal workspace details.", "Provide CSV/JSON evidence with digest headers for finance or client records."],
    proof: ["Phase-by-phase design effort", "Revision and feedback work captured alongside production", "Planned-versus-actual review before invoice", "Approval-ready proof packet with export option"],
    faqs: [{ question: "Can I track revisions separately from production?", answer: "Yes. Plan or log revision work against the project so it can be reviewed beside the original production effort." }, { question: "Will clients see my internal notes?", answer: "Client sign-off is focused on proof packets, not your internal timers, planning, or workspace controls." }, { question: "Can I export a record for a client purchasing team?", answer: "Yes. SOWLedger supports filtered CSV and JSON exports with integrity digest headers." }],
  },
  {
    slug: "legal-consultants", name: "Legal Consultants", category: "Advisory and matter-based work",
    heroLabel: "Proof-backed billing for legal consultants", heroHeadline: "Keep matter work ready for invoice review.",
    heroSubhead: "Capture consultation, research, drafting, and client coordination with a clear record for approved engagement billing.",
    workflowHeadline: "Matter work is easier to review before it becomes an invoice.", workflowSubhead: "Use planning, live capture, corrections, and client-safe proof to keep the work record clear.",
    challenges: ["Research, drafting, and calls can be fragmented across a matter timeline.", "Short client requests often need to be added after the fact.", "Engagement billing needs a careful, reviewable explanation of time."],
    work: ["Plan matter milestones, review sessions, drafting blocks, and consultations.", "Track active advisory, drafting, and research time with live timers.", "Add manual entries for follow-up, document review, and client coordination.", "Review planned versus actual time before preparing engagement billing.", "Use an approval-ready proof packet for the agreed client billing process.", "Export filtered billing evidence with digest headers for record keeping."],
    proof: ["Matter-level planned and actual time", "Manual, timer, and calendar source context", "Approval trail for reviewable billing", "Filtered CSV/JSON export with digest header"],
    faqs: [{ question: "Does SOWLedger provide legal case management?", answer: "No. It focuses on the planning, time, review, approval, invoicing, and export workflow around billable service work." }, { question: "Can I correct a time entry before it is billed?", answer: "Yes. The activity and review workflow is built for correcting the logged work record before approval or invoicing." }, { question: "Can I export only one client or matter?", answer: "Yes. Use complete or filtered CSV/JSON exports for the relevant work record." }],
  },
  {
    slug: "accounting-firms", name: "Accounting Firms", category: "Firm operations and advisory",
    heroLabel: "Proof-backed billing for accounting firms", heroHeadline: "Protect busy-season capacity and engagement margins.",
    heroSubhead: "Keep tax, audit, bookkeeping, and advisory effort visible across clients before the engagement reaches the billing desk.",
    workflowHeadline: "Firm teams can review engagement effort before it leaks.", workflowSubhead: "Bring planned capacity, active client work, approval, and export evidence into one operating record.",
    challenges: ["Busy-season work shifts quickly between tax, audit, and advisory clients.", "Partner review needs a clear view of effort before fixed-fee work drifts.", "Staff follow-up and client coordination can fall outside formal task tracking."],
    work: ["Allocate engagement phases, deadlines, and recurring client work on the calendar.", "Use live timers for focused preparation, analysis, and advisory sessions.", "Add manual entries for client coordination, review notes, and corrections.", "Compare engagement plans, actual time, and billable output before invoicing.", "Route an approval-ready proof packet through your client billing process.", "Export records or send scoped API/webhook events to connected firm systems."],
    proof: ["Engagement capacity and actual effort", "Source mix across planned, timer, manual, and calendar work", "Partner-ready billable output review", "Digest-backed export and approval evidence"],
    faqs: [{ question: "Can we use SOWLedger across firm teams?", answer: "Yes. The product is designed for workspaces where teams plan, track, review, approve, export, and integrate their service work." }, { question: "Does it replace accounting software?", answer: "No. It provides the proof-backed work record; use exports, scoped API keys, and webhooks to connect downstream processes." }, { question: "Can we review fixed-fee engagements?", answer: "Yes. Planned-versus-actual analytics help teams review how engagement effort is tracking before billing." }],
  },
  {
    slug: "video-editors", name: "Video Editors", category: "Post-production delivery",
    heroLabel: "Proof-backed billing for video editors", heroHeadline: "Keep edit rounds and delivery work visible.",
    heroSubhead: "Capture editing sessions, review feedback, revisions, and delivery coordination in a billing record built for post-production work.",
    workflowHeadline: "Each cut has a clear work record behind it.", workflowSubhead: "Plan the edit, capture active sessions and revision work, then hand off proof with the final billing record.",
    challenges: ["Revision rounds can multiply after the initial edit is delivered.", "Review notes and delivery coordination are easy to lose beside hands-on editing.", "A project can include long periods of focused post-production across several cuts."],
    work: ["Plan rough cuts, review rounds, final delivery, and client coordination.", "Track active editing, review, and finishing sessions with live timers.", "Record manual time for revision requests, notes, and delivery follow-up.", "Compare the planned edit budget with actual post-production effort.", "Use a client-safe proof packet to confirm the billing record.", "Share a filtered, digest-backed CSV or JSON export when needed."],
    proof: ["Edit-phase planned and actual time", "Revision and delivery coordination record", "Client sign-off context before invoice", "Filtered export with SHA-256 digest header"],
    faqs: [{ question: "Can I capture time for review rounds?", answer: "Yes. Track review sessions live or add manual entries for consolidated feedback and client follow-up." }, { question: "Does SOWLedger measure render output?", answer: "No. It records the service work you plan, track, log, review, approve, invoice, and export." }, { question: "Can clients approve the work record?", answer: "Yes. Client sign-off can focus on the relevant proof packet rather than your internal editing workflow." }],
  },
  {
    slug: "copywriters", name: "Copywriters", category: "Editorial and conversion work",
    heroLabel: "Proof-backed billing for copywriters", heroHeadline: "Make research, drafting, and revisions count.",
    heroSubhead: "Keep the work before and after the draft—interviews, research, editing, and stakeholder feedback—in a clear billing record.",
    workflowHeadline: "The work behind the words stays easy to explain.", workflowSubhead: "Plan editorial milestones, capture the writing process, then give clients proof that follows the agreed scope.",
    challenges: ["Discovery and research are often substantial but invisible beside the final copy.", "Feedback cycles can expand beyond the original writing assignment.", "Short edits and client questions interrupt deep writing time."],
    work: ["Plan research, interviews, outlines, drafts, and review dates by project.", "Track focused writing, editing, and interview sessions live.", "Add manual entries for stakeholder feedback, source review, and quick edits.", "Review actual effort against the planned editorial scope before billing.", "Share client-safe work proof for sign-off with the invoice context.", "Export completed records in CSV or JSON with digest headers."],
    proof: ["Research-to-revision work record", "Writing project planned-versus-actual review", "Source mix for live, manual, and calendar time", "Client proof packet and digest-backed export"],
    faqs: [{ question: "Can I log interview and research time?", answer: "Yes. Plan it in advance, use a timer during the work, or add a manual entry after it is complete." }, { question: "Can I review revision effort before billing?", answer: "Yes. Review the project record and planned-versus-actual effort before approval or invoicing." }, { question: "Does SOWLedger generate copy?", answer: "No. It is the operational and billing record around your writing service." }],
  },
  {
    slug: "pr-agencies", name: "PR Agencies", category: "Communications and media relations",
    heroLabel: "Proof-backed billing for PR agencies", heroHeadline: "Keep retainer work visible beyond the placement.",
    heroSubhead: "Capture media strategy, pitching, monitoring, client coordination, and reporting effort in a work record that supports the account relationship.",
    workflowHeadline: "PR account work is visible from strategy to reporting.", workflowSubhead: "Plan campaign cadence, capture the active effort, and use clear proof before the retainer invoice goes out.",
    challenges: ["Pitching, monitoring, and follow-up happen across many short work blocks.", "Account coordination and reporting can compete with time reserved for proactive outreach.", "Clients may only see outcomes, not the ongoing work behind media relations."],
    work: ["Schedule campaign windows, client calls, reporting cycles, and outreach blocks.", "Track active strategy, pitching, media research, and reporting sessions.", "Capture manual entries for quick follow-up, monitoring, and coordination.", "Compare planned retainer work with completed account effort.", "Provide a client-safe proof packet before finalizing the invoice.", "Use exports or scoped API keys and webhooks for connected agency processes."],
    proof: ["Retainer planned-versus-actual work", "Outreach, reporting, and coordination source mix", "Approval-ready account proof", "Digest-backed CSV/JSON export or event integration"],
    faqs: [{ question: "Can we track work across multiple client accounts?", answer: "Yes. Plan and log work by project so account teams can review the right record before each billing cycle." }, { question: "Does SOWLedger track media coverage?", answer: "No. It tracks the work and billing evidence around your PR service; connect external systems with exports or scoped APIs and webhooks." }, { question: "Can a client approve a monthly work record?", answer: "Yes. Use the client sign-off flow to share a focused proof packet for approval." }],
  },
  {
    slug: "it-consultants", name: "IT Consultants", category: "Technology operations and advisory",
    heroLabel: "Proof-backed billing for IT consultants", heroHeadline: "Turn support work into a defensible record.",
    heroSubhead: "Keep planned maintenance, incident response, infrastructure changes, and client support visible before they become unbilled interruptions.",
    workflowHeadline: "Operational work gets captured before it disappears.", workflowSubhead: "Use calendar-aware planning, live timers, manual logging, and proof-backed approval for technical service work.",
    challenges: ["Urgent support interrupts planned infrastructure work throughout the day.", "Maintenance follow-up can be forgotten after the immediate issue is resolved.", "Clients need a clear billing record without access to internal operational detail."],
    work: ["Plan maintenance windows, client reviews, migrations, and recurring service blocks.", "Start a live timer for active support, troubleshooting, and infrastructure changes.", "Add manual time for asynchronous follow-up, documentation, and vendor coordination.", "Compare planned service coverage with actual effort and billable output.", "Share a client-safe proof packet before issuing support or project invoices.", "Use scoped API keys, webhooks, and exports to move approved records downstream."],
    proof: ["Maintenance, support, and project work record", "Calendar, live-timer, and manual source mix", "Planned-versus-actual service coverage review", "Client-safe approval and digest-backed export"],
    faqs: [{ question: "Can I log work after an incident is closed?", answer: "Yes. Add a manual entry for follow-up, documentation, or coordination, then review it before billing." }, { question: "Does SOWLedger replace a ticketing system?", answer: "No. It is the work and billing record; use exports, scoped API keys, and webhooks to connect your existing systems." }, { question: "Can recurring maintenance be planned?", answer: "Yes. Use planning and calendar blocks for recurring work, then compare what was planned with actual time." }],
  },
  {
    slug: "management-consultants", name: "Management Consultants", category: "Strategy and transformation advisory",
    heroLabel: "Proof-backed billing for management consultants", heroHeadline: "Keep advisory effort connected to the engagement.",
    heroSubhead: "Track discovery, workshops, analysis, executive preparation, and client follow-up in a work record that holds up at billing time.",
    workflowHeadline: "Advisory work stays clear across the engagement lifecycle.", workflowSubhead: "Plan each phase, capture what happens between meetings, and use approval-ready proof to support the invoice.",
    challenges: ["Preparation and synthesis often take more time than the visible workshop.", "Executive follow-up and stakeholder coordination happen in short, scattered intervals.", "Fixed-fee work needs an internal view of planned versus actual effort."],
    work: ["Map discovery, workshops, analysis, readouts, and stakeholder meetings to the engagement.", "Track active analysis, workshop delivery, and preparation sessions.", "Record manual entries for synthesis, follow-up, and client coordination.", "Compare phase plans and actual effort before a milestone or invoice review.", "Give clients focused sign-off proof aligned to the agreed engagement work.", "Export complete or filtered records with digest headers for client or finance files."],
    proof: ["Engagement phase effort and actuals", "Workshop, analysis, and follow-up source context", "Internal fixed-fee review before billing", "Client approval proof and integrity-backed export"],
    faqs: [{ question: "Can I separate preparation from workshop time?", answer: "Yes. Plan and log both against the engagement so the project record reflects the full advisory effort." }, { question: "Is SOWLedger useful for fixed-fee consulting?", answer: "Yes. Planned-versus-actual analytics help you understand effort before a milestone or invoice review." }, { question: "Can clients receive a focused proof record?", answer: "Yes. Client sign-off is built for reviewable proof packets rather than your internal workspace." }],
  },
  {
    slug: "web-design-studios", name: "Web Design Studios", category: "Digital product and site delivery",
    heroLabel: "Proof-backed billing for web design studios", heroHeadline: "Keep every build phase connected to the bill.",
    heroSubhead: "Capture discovery, UX, visual design, implementation coordination, QA, and launch support in a shared client work record.",
    workflowHeadline: "Studio delivery stays visible from kickoff through launch.", workflowSubhead: "Plan the sprint, capture work across disciplines, review the record, then approve, invoice, export, or integrate it.",
    challenges: ["Discovery, design, QA, and launch support can cross project boundaries quickly.", "Client feedback adds small bursts of work across design and implementation teams.", "Studios need a shared view of sprint effort before billing a milestone or retainer."],
    work: ["Plan discovery, design sprints, QA, launch preparation, and client reviews.", "Track focused design, project coordination, QA, and delivery sessions.", "Add manual entries for client feedback, handoffs, and launch follow-up.", "Compare planned sprint capacity, actual time, and billable output across the studio.", "Use client-safe proof packets to support milestone or retainer sign-off.", "Export work records or use scoped API keys and webhooks with connected systems."],
    proof: ["Sprint and milestone planned-versus-actual work", "Cross-discipline timer, manual, and calendar source mix", "Client-safe approval trail for a milestone", "Digest-backed exports plus scoped API/webhook options"],
    faqs: [{ question: "Can a studio track work across design and delivery roles?", answer: "Yes. Teams can plan, track, log, review, approve, export, and integrate work in the shared workspace." }, { question: "Does SOWLedger host or deploy websites?", answer: "No. It is the operational billing record around your studio work, with scoped API keys, webhooks, and exports for connected workflows." }, { question: "Can we use it for milestone billing?", answer: "Yes. Review the planned-versus-actual record, gather approval, and issue the invoice with supporting proof." }],
  },
];

export const industries: IndustryContent[] = industrySeeds.map(({ work, proof, ...industry }) => ({
  ...industry,
  workflow: workflowStages.map((stage, index) => ({ stage, detail: work[index] })),
  proofOutputs: proof,
}));
