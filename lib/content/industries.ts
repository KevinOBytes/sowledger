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

const workflowStages = ["Plan", "Track", "Log", "Review", "Approve", "Integrate"] as const;

const industrySeeds: IndustrySeed[] = [
  {
    slug: "freelance-developers", name: "Freelance Developers", category: "Software development",
    heroLabel: "For freelance developers", heroHeadline: "Keep the whole job on the timesheet.",
    heroSubhead: "Discovery calls, debugging, and release follow-up are part of the job, too. Track them alongside the build so your invoice reflects the work you did.",
    workflowHeadline: "From discovery to handoff", workflowSubhead: "Set aside time for development, log the interruptions, and review each project's hours before billing.",
    challenges: ["Debugging stretches beyond the estimate, but the extra time never gets logged.", "A quick support request interrupts a build and disappears from the timesheet.", "A client asks what went into the invoice after the project has shipped."],
    work: ["Schedule discovery, development, testing, and release work by project.", "Start a timer while coding, debugging, or talking through a technical decision.", "Add time for support messages, documentation, and release follow-up.", "Compare the hours you planned with the time each project actually took.", "Review completed entries and prepare approved billable time for an invoice.", "Use the API to bring project and time records into your own reporting tools."],
    proof: ["Hours and descriptions for development and support work", "Planned and actual time by project", "Approved time and the rates used on an invoice", "CSV or JSON records for your bookkeeping"],
    faqs: [{ question: "Does SOWLedger connect to GitHub?", answer: "There is no native GitHub integration. Use timers, manual entries, or completed calendar blocks to record your work. API access and webhooks are available for custom integrations." }, { question: "Can I explain the hours on an invoice?", answer: "Yes. Invoice details include the linked time entries, work descriptions, hours, and rates. Review descriptions before making an invoice available to a client." }, { question: "Can I track ongoing support work?", answer: "Yes. Log short requests against the client's project and review them together. SOWLedger does not automatically bill recurring retainers." }],
  },
  {
    slug: "marketing-agencies", name: "Marketing Agencies", category: "Campaigns and client accounts",
    heroLabel: "For marketing agencies", heroHeadline: "Know what each client account takes.",
    heroSubhead: "Keep strategy, production, account meetings, and reporting time together. Give account leads a clearer picture before the next client review.",
    workflowHeadline: "From campaign planning to billing", workflowSubhead: "Track the work across a campaign without losing the meetings and follow-up around it.",
    challenges: ["Campaign work is spread across strategy, creative, and account teams.", "Client requests add up between planned production blocks.", "Account leads need to check hours before approving the monthly bill."],
    work: ["Schedule campaign work, production sessions, and client meetings.", "Track creative work, account management, and campaign analysis as they happen.", "Log reporting, client messages, and follow-up that happened off the timer.", "Compare planned campaign hours with actual time and billable work.", "Approve the team's time for invoicing, then let the client review the issued invoice.", "Export account records or use the API to feed your agency's reporting tools."],
    proof: ["Campaign hours organized by project", "Time spent on production, coordination, and reporting", "A record of reviewed work and client approval", "Exports for account reporting and finance"],
    faqs: [{ question: "Can we review work covered by a retainer?", answer: "You can compare project time with your planned hours and budget. Recurring retainer billing is not automated; keep the retainer agreement and billing schedule in your existing process." }, { question: "What can clients see?", answer: "Clients can review their project summaries, issued invoices, and linked work through the portal. They do not get access to team timers, calendar planning, or workspace settings. Check shared descriptions before inviting them." }, { question: "Can we use the records in another system?", answer: "Yes. Export CSV or JSON, or build a connection using workspace API keys and webhooks on a supported plan." }],
  },
  {
    slug: "seo-consultants", name: "SEO Consultants", category: "Search strategy and analysis",
    heroLabel: "For SEO consultants", heroHeadline: "Account for the research behind the recommendations.",
    heroSubhead: "Track technical audits, keyword research, stakeholder calls, and reporting. Keep a clear record of the time that went into each client's recommendations.",
    workflowHeadline: "From audit to recommendations", workflowSubhead: "Plan the research, log analysis and follow-up, then review the engagement before invoicing.",
    challenges: ["A technical audit takes hours before there is a deliverable to show.", "Research and reporting get mixed together across several clients.", "Implementation questions continue after the recommendations are delivered."],
    work: ["Reserve time for audits, research, reporting, and stakeholder reviews.", "Track analysis and working sessions with a timer.", "Add time for annotations, written recommendations, and client questions.", "Review the hours for each audit or reporting period.", "Approve the completed entries for invoicing, then share the issued invoice for client review.", "Export project hours for your reporting process or connect through the API."],
    proof: ["Audit and research hours by project", "Descriptions of analysis and implementation guidance", "Planned and actual effort for the period", "Invoice details and exportable time records"],
    faqs: [{ question: "Can I log research outside meetings?", answer: "Yes. Start a timer while researching or add the completed work as a manual entry." }, { question: "Does SOWLedger replace my SEO tools?", answer: "No. It tracks time, planning, and invoicing around your SEO work. Keep using your existing tools for rankings, crawling, and search analysis." }, { question: "Can I review a month's work together?", answer: "Yes. Filter by project and date range to review the period. Recurring retainer invoices are not generated automatically." }],
  },
  {
    slug: "graphic-designers", name: "Graphic Designers", category: "Design and creative work",
    heroLabel: "For graphic designers", heroHeadline: "Keep track of the revisions, too.",
    heroSubhead: "Record concept development, production, feedback, and handoff time. See how much work went into a design before you prepare the bill.",
    workflowHeadline: "From the brief to final files", workflowSubhead: "Plan design sessions and review rounds, then keep the extra requests in the same project record.",
    challenges: ["Concept exploration takes time that is easy to leave off the invoice.", "A small change becomes another round of revisions.", "Feedback arrives in short bursts between other client projects."],
    work: ["Schedule concept development, production, and client reviews.", "Track focused illustration, layout, and production sessions.", "Log feedback calls, quick edits, and final-file preparation.", "Compare the original time estimate with actual design and revision work.", "Review descriptions and approve the hours before creating an invoice.", "Export project time for bookkeeping or use the API with your studio tools."],
    proof: ["Time spent on concepts, production, and revisions", "Descriptions that distinguish feedback rounds", "Planned and actual design hours", "Reviewed entries and invoice details"],
    faqs: [{ question: "Can I track revisions separately?", answer: "Yes. Give revision entries clear descriptions or tags so you can distinguish them from initial production work." }, { question: "Will clients see my notes?", answer: "Work descriptions may be included in shared project and invoice details. Review them before sharing, and keep private creative notes in your own documents." }, { question: "Can I send the records to a purchasing team?", answer: "Yes. Export time records as CSV or JSON and review the file before sending it outside your workspace." }],
  },
  {
    slug: "legal-consultants", name: "Legal Consultants", category: "Matter-based advisory work",
    heroLabel: "For legal consultants", heroHeadline: "Make time easier to review by matter.",
    heroSubhead: "Keep consultation, research, drafting, and coordination time organized by project. Review the entries before preparing engagement billing.",
    workflowHeadline: "From consultation to billing review", workflowSubhead: "Record the work as it happens and check descriptions carefully before sharing them.",
    challenges: ["Research, drafting, and calls are scattered throughout a matter.", "Short client requests need to be recorded after the conversation.", "Billing descriptions need a careful review before they leave the team."],
    work: ["Create a project for the matter and schedule research, drafting, and consultations.", "Track active advisory work with a timer.", "Add completed calls, document review, and follow-up manually.", "Check planned and actual time and review the wording of each entry.", "Use your agreed review process before approving time for invoicing.", "Export the relevant records for your firm's billing process."],
    proof: ["Time records organized by matter project", "Dates, hours, and reviewed work descriptions", "Entry status and approval history", "Project-filtered CSV time records"],
    faqs: [{ question: "Is SOWLedger legal case-management software?", answer: "No. It provides planning, time tracking, review, and invoicing tools. It does not replace matter management or establish suitability for privileged or regulated information." }, { question: "Can I correct an entry before billing?", answer: "Yes. Review and correct draft entries before submitting them. Approved or invoiced time has additional restrictions to preserve the billing record." }, { question: "Can I export one matter's time?", answer: "Yes. Use a project filter on the time-entry CSV export. Review the file before sharing; a full JSON workspace export includes additional workspace records." }],
  },
  {
    slug: "accounting-firms", name: "Accounting Firms", category: "Tax, accounting, and advisory",
    heroLabel: "For accounting firms", heroHeadline: "See the time behind each engagement.",
    heroSubhead: "Keep preparation, review, advisory, and client follow-up visible across your firm. Compare the work you planned with the hours it actually took.",
    workflowHeadline: "From engagement planning to review", workflowSubhead: "Give the team a shared place to log work and check hours before the engagement reaches billing.",
    challenges: ["Busy-season priorities move quickly between client engagements.", "Review and client coordination can take as much time as preparation.", "Fixed-fee work needs an internal check on actual effort."],
    work: ["Schedule preparation, review, deadlines, and client meetings by engagement.", "Track focused preparation, analysis, and advisory sessions.", "Add time for document requests, review notes, and client follow-up.", "Compare engagement hours with the time you planned.", "Review the completed work and approve time for hourly invoicing.", "Export time records for your accounting and practice-management process."],
    proof: ["Hours by engagement project", "Preparation, review, and follow-up descriptions", "Planned and actual effort for internal review", "Approved time and downloadable records"],
    faqs: [{ question: "Can several people work in one workspace?", answer: "Yes. Paid plans include different member limits, so the team can log and review work together. Check Pricing for the current limits." }, { question: "Does it replace accounting software?", answer: "No. SOWLedger handles work planning, time, and time-based invoices. Use exports or an available integration with your accounting process." }, { question: "Can we track fixed-fee engagements?", answer: "Yes, for time and effort review. Time tracking does not create a fixed-fee or recurring billing schedule; manage those billing arrangements separately." }],
  },
  {
    slug: "video-editors", name: "Video Editors", category: "Editing and post-production",
    heroLabel: "For video editors", heroHeadline: "Know how much time went into the final cut.",
    heroSubhead: "Track editing, review rounds, revisions, and delivery preparation. Keep the client requests around the edit on the record, too.",
    workflowHeadline: "From rough cut to delivery", workflowSubhead: "Plan editing sessions, record revisions, and check the hours before billing the project.",
    challenges: ["Review rounds continue after the first cut is delivered.", "Client notes and delivery coordination happen between editing sessions.", "Several versions make it harder to remember where the time went."],
    work: ["Schedule rough cuts, reviews, finishing, and delivery work.", "Run a timer during active editing, grading, and review sessions.", "Log client notes, revision requests, and delivery follow-up.", "Compare actual editing hours with the project estimate.", "Review and approve the entries before creating a time-based invoice.", "Export project hours for your production or finance tools."],
    proof: ["Hours for editing and review sessions", "Descriptions of revision and delivery work", "Planned and actual post-production time", "Reviewed time entries behind an invoice"],
    faqs: [{ question: "Can I record review rounds?", answer: "Yes. Use separate entries and clear descriptions for each review or revision session." }, { question: "Does SOWLedger measure render time?", answer: "No. It records the time you log; it does not monitor your editing software or render jobs." }, { question: "Can a client review the work?", answer: "Yes. The client portal lets clients review their issued invoices and record approval. Check the entry descriptions before sharing." }],
  },
  {
    slug: "copywriters", name: "Copywriters", category: "Writing and editorial work",
    heroLabel: "For copywriters", heroHeadline: "Track more than the time spent drafting.",
    heroSubhead: "Interviews, research, editing, and feedback all take time. Keep them alongside the draft in a project record you can review before billing.",
    workflowHeadline: "From research to final copy", workflowSubhead: "Plan the assignment, track focused writing, and log the conversations and revisions around it.",
    challenges: ["Research and interviews take place before there are words on the page.", "Feedback rounds expand beyond the original assignment.", "Short edits and stakeholder questions interrupt focused writing time."],
    work: ["Schedule research, interviews, outlines, drafts, and reviews.", "Track writing, editing, and interview sessions as you work.", "Add source review, stakeholder feedback, and quick edits manually.", "Compare the assignment's planned hours with actual effort.", "Review the entries and prepare approved time for invoicing.", "Export hours for bookkeeping or connect them to your reporting process."],
    proof: ["Research, writing, and revision hours", "Work descriptions for each assignment", "Planned and actual project effort", "Invoice details and exportable time records"],
    faqs: [{ question: "Can I log interview and research time?", answer: "Yes. Use a timer during the work or add the time manually afterward." }, { question: "Can I check revision time before billing?", answer: "Yes. Keep revision entries under the project and review the hours and descriptions before submitting them." }, { question: "Does SOWLedger write copy?", answer: "No. It helps you plan, track, and bill for your writing work." }],
  },
  {
    slug: "pr-agencies", name: "PR Agencies", category: "Communications and media relations",
    heroLabel: "For PR agencies", heroHeadline: "Keep the account work visible between placements.",
    heroSubhead: "Record media research, pitching, client coordination, and reporting. Give account teams a practical way to review the effort behind the results.",
    workflowHeadline: "From outreach planning to account review", workflowSubhead: "Plan client work and capture the short research, pitching, and follow-up sessions that fill the day.",
    challenges: ["Pitching and media follow-up happen in many short sessions.", "Client coordination competes with time reserved for outreach.", "A monthly report may show results without showing the effort involved."],
    work: ["Schedule outreach, client calls, research, and reporting.", "Track strategy, media research, pitching, and writing sessions.", "Add quick follow-up and client coordination that happened off the timer.", "Review completed hours against the account's planned work.", "Approve the account's time for invoicing and make the issued invoice available for client review.", "Export account time into your agency reporting process."],
    proof: ["Account hours by project and period", "Descriptions of outreach and coordination work", "Planned and actual time for account reviews", "Client approvals and exportable records"],
    faqs: [{ question: "Can we track several client accounts?", answer: "Yes. Create projects for client work and keep entries assigned to the right project." }, { question: "Does SOWLedger track media coverage?", answer: "No. It records your team's work and time. Keep using your existing media-monitoring and reporting tools." }, { question: "Can we review retainer work each month?", answer: "Yes. Review the project's hours by date range. SOWLedger does not automatically generate recurring retainer invoices." }],
  },
  {
    slug: "it-consultants", name: "IT Consultants", category: "IT support and infrastructure",
    heroLabel: "For IT consultants", heroHeadline: "Log the support work before the next call comes in.",
    heroSubhead: "Keep maintenance, troubleshooting, infrastructure changes, and follow-up in one time record. Review what each client needed before you bill.",
    workflowHeadline: "From planned maintenance to urgent support", workflowSubhead: "Use timers for active work and manual entries when the incident had to come first.",
    challenges: ["Urgent requests interrupt planned infrastructure work.", "Documentation and vendor follow-up are easy to forget once an issue is resolved.", "A client needs an explanation of the hours on a support invoice."],
    work: ["Schedule maintenance, migrations, and client reviews.", "Start a timer for troubleshooting or infrastructure work.", "Add completed incident response, documentation, and vendor calls manually.", "Compare planned service work with actual client hours.", "Check descriptions and rates before approving time for invoicing.", "Use exports or the API alongside your existing service tools."],
    proof: ["Time recorded for support and maintenance", "Descriptions of follow-up and coordination", "Planned and actual project hours", "Invoice entries and downloadable time records"],
    faqs: [{ question: "Can I add time after an incident?", answer: "Yes. Add a manual entry with the times, project, and a description of the work, then review it before billing." }, { question: "Does SOWLedger replace a ticketing system?", answer: "No. It manages time, planning, and time-based invoices. Use your existing ticketing system for service requests." }, { question: "Can I plan future maintenance?", answer: "Yes. Create calendar blocks for each maintenance window and log the completed work afterward." }],
  },
  {
    slug: "management-consultants", name: "Management Consultants", category: "Strategy and business advisory",
    heroLabel: "For management consultants", heroHeadline: "Track the work around the workshop.",
    heroSubhead: "Discovery, analysis, preparation, and follow-up often take longer than the meeting itself. Keep that effort visible across the engagement.",
    workflowHeadline: "From discovery to recommendations", workflowSubhead: "Plan the engagement, record preparation and delivery, and review the hours before the client conversation.",
    challenges: ["Preparation and synthesis take place outside the visible workshop.", "Stakeholder coordination happens in short, scattered conversations.", "Fixed-fee engagements still need a clear view of actual effort."],
    work: ["Schedule discovery, analysis, workshops, and client readouts.", "Track focused preparation, analysis, and workshop delivery.", "Add synthesis, stakeholder follow-up, and coordination manually.", "Compare planned and actual engagement hours.", "Review the entries and approve time-based charges where appropriate.", "Export engagement hours for your firm's reporting and finance process."],
    proof: ["Preparation, workshop, and follow-up hours", "Work descriptions organized by engagement", "Planned and actual effort for internal review", "Reviewed time records and invoice details"],
    faqs: [{ question: "Can I separate preparation from delivery?", answer: "Yes. Log them as separate entries with clear descriptions under the same project." }, { question: "Can I track fixed-fee consulting work?", answer: "Yes. Track actual effort and compare it with your plan. Fixed-fee, milestone, and recurring billing schedules are not automated." }, { question: "Can clients review the work?", answer: "Yes. Clients can review their issued invoices and related work through the portal without access to team planning or workspace administration." }],
  },
  {
    slug: "web-design-studios", name: "Web Design Studios", category: "Website design and delivery",
    heroLabel: "For web design studios", heroHeadline: "Keep design, build, and launch time together.",
    heroSubhead: "Track discovery, design, development coordination, QA, and launch support across your studio. See what each project took before preparing the bill.",
    workflowHeadline: "From kickoff through launch", workflowSubhead: "Give each discipline a place to record its work, including the feedback and handoffs between teams.",
    challenges: ["Discovery, design, and QA involve different people and schedules.", "Client feedback adds work across both design and implementation.", "Launch support continues after the main build is finished."],
    work: ["Schedule discovery, design sessions, QA, and launch preparation.", "Track design, coordination, testing, and delivery work.", "Log client feedback, handoffs, and post-launch follow-up manually.", "Compare the studio's planned hours with actual project time.", "Review completed work and approve time-based invoice entries.", "Export project records or connect your studio tools through the API."],
    proof: ["Hours across design, QA, and delivery", "Descriptions of feedback and launch support", "Planned and actual project time", "Client review records and invoice details"],
    faqs: [{ question: "Can several roles track work in the same project?", answer: "Yes. Team members can record time against the shared project, within the workspace's plan limits." }, { question: "Does SOWLedger host or deploy websites?", answer: "No. It helps you plan, track, review, and bill for studio work." }, { question: "Does SOWLedger support milestone billing?", answer: "Not currently. You can track time across project phases, but invoices are created from approved billable time. Manage milestone payment schedules separately." }],
  },
];

export const industries: IndustryContent[] = industrySeeds.map(({ work, proof, ...industry }) => ({
  ...industry,
  workflow: workflowStages.map((stage, index) => ({ stage, detail: work[index] })),
  proofOutputs: proof,
}));
