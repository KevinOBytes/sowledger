export type Industry = "freelance-developers" | "marketing-agencies" | "seo-consultants" | "legal-professionals";

export interface SEOContent {
  slug: Industry;
  title: string;
  description: string;
  heroHeadline: string;
  heroSubheadline: string;
  features: { title: string; description: string }[];
}

export const seoContent: Record<Industry, SEOContent> = {
  "freelance-developers": {
    slug: "freelance-developers",
    title: "Time Tracking and Invoicing for Freelance Developers - SOWLedger",
    description: "The complete toolkit for freelance software engineers to track billable hours, schedule work blocks, and automatically generate client invoices.",
    heroHeadline: "Track code, bill clients, and stay focused",
    heroSubheadline: "SOWLedger gives freelance developers a single platform to turn commits and deep work sessions into paid invoices effortlessly.",
    features: [
      {
        title: "Developer-First Time Tracking",
        description: "Log hours seamlessly alongside your code. Built for the workflows of modern software engineering.",
      },
      {
        title: "API First",
        description: "Automate your billing. Use the SOWLedger MCP server and REST API to sync hours from your CLI or custom tools.",
      },
      {
        title: "Proof of Work",
        description: "Export detailed CSV/JSON logs to attach to invoices, providing your clients with undeniable proof of work.",
      },
    ],
  },
  "marketing-agencies": {
    slug: "marketing-agencies",
    title: "Agency Time Tracking and Client Approvals - SOWLedger",
    description: "Manage client retainers, track billable agency hours, and streamline approval workflows with SOWLedger.",
    heroHeadline: "Turn agency hours into billable revenue",
    heroSubheadline: "Stop losing track of retainer hours. SOWLedger helps marketing agencies plan campaigns, track team time, and get client sign-off fast.",
    features: [
      {
        title: "Team Workspaces",
        description: "Organize your agency by client or project. Invite team members with role-based access control.",
      },
      {
        title: "Client Approvals",
        description: "Send timesheets directly to clients for approval before generating invoices. Build trust through transparency.",
      },
      {
        title: "Retainer Tracking",
        description: "Set project budgets and monitor real-time burn rates so you never over-service a retainer again.",
      },
    ],
  },
  "seo-consultants": {
    slug: "seo-consultants",
    title: "Time and Project Management for SEO Consultants - SOWLedger",
    description: "Track time spent on audits, content briefs, and technical SEO implementations. Bill accurately with SOWLedger.",
    heroHeadline: "Bill for every technical audit",
    heroSubheadline: "SOWLedger gives SEO consultants the precision needed to track time across multiple clients, campaigns, and technical audits.",
    features: [
      {
        title: "Concurrent Tracking",
        description: "Running a crawler in the background? Track multiple concurrent tasks with our stackable timer system.",
      },
      {
        title: "Campaign Scheduling",
        description: "Plan your deep-dive SEO audits in advance on the Calendar, and start timers directly from your planned blocks.",
      },
      {
        title: "Detailed Reporting",
        description: "Show clients exactly how much time went into technical fixes versus content strategy with tagged time entries.",
      },
    ],
  },
  "legal-professionals": {
    slug: "legal-professionals",
    title: "Billable Hour Tracking for Legal Professionals - SOWLedger",
    description: "Secure, precise, and professional time tracking for law firms and solo practitioners.",
    heroHeadline: "Every minute accounted for",
    heroSubheadline: "SOWLedger provides legal professionals with the rigorous time tracking and reporting needed for accurate client billing.",
    features: [
      {
        title: "Precise Increments",
        description: "Track time down to the minute. Log calls, document review, and court time accurately.",
      },
      {
        title: "Secure & Private",
        description: "Your data is segregated by workspace. Export reports securely for internal firm audits or client billing.",
      },
      {
        title: "Manual Adjustments",
        description: "Forgot to start a timer during a client call? Easily log manual time blocks retroactively.",
      },
    ],
  },
};
