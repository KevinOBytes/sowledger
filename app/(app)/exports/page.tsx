"use client";

import { useEffect, useMemo, useState } from "react";
import { Archive, Download, FileJson, FileSpreadsheet, Filter, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

type Project = { id: string; name: string };
type Person = {
  id: string;
  linkedUserId?: string | null;
  displayName?: string | null;
  email?: string | null;
  personType: "member" | "client" | "contractor" | "contact";
  invitationStatus: "none" | "pending" | "accepted";
};

type ExportFormat = "csv" | "json";
type ExportLayout = "detailed" | "summary";

const DATASETS = [
  { id: "workspace", label: "Workspace metadata" },
  { id: "users", label: "Users" },
  { id: "memberships", label: "Memberships" },
  { id: "clients", label: "Clients" },
  { id: "projects", label: "Projects" },
  { id: "tasks", label: "Project tasks" },
  { id: "schedule", label: "Scheduled work blocks" },
  { id: "timeEntries", label: "Time entries" },
  { id: "tags", label: "Tags" },
  { id: "goals", label: "Goals" },
  { id: "invoices", label: "Invoices" },
  { id: "auditLogs", label: "Audit logs" },
  { id: "apiUsage", label: "API usage metadata" },
];

function today() {
  return new Date().toISOString().slice(0, 10);
}

function thirtyDaysAgo() {
  const date = new Date();
  date.setDate(date.getDate() - 30);
  return date.toISOString().slice(0, 10);
}

export default function ExportsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [format, setFormat] = useState<ExportFormat>("json");
  const [layout, setLayout] = useState<ExportLayout>("detailed");
  const [projectId, setProjectId] = useState("");
  const [start, setStart] = useState(thirtyDaysAgo());
  const [end, setEnd] = useState(today());
  const [userId, setUserId] = useState("");
  const [status, setStatus] = useState("");
  const [source, setSource] = useState("");
  const [include, setInclude] = useState<string[]>(DATASETS.map((item) => item.id));
  const [downloading, setDownloading] = useState(false);
  const [lastDigest, setLastDigest] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([fetch("/api/projects"), fetch("/api/people")])
      .then(async ([projectsRes, peopleRes]) => {
        const projectsData = await projectsRes.json();
        const peopleData = await peopleRes.json();
        setProjects(projectsData.projects ?? []);
        setPeople((peopleData.people ?? []).filter((person: Person) => person.personType === "member" && person.invitationStatus === "accepted" && person.linkedUserId));
      })
      .catch(() => null);
  }, []);

  const completeExport = include.length === DATASETS.length && !projectId && !userId && !status && !source;
  const selectedProjectName = useMemo(() => projects.find((project) => project.id === projectId)?.name, [projectId, projects]);

  function toggleDataset(id: string) {
    setInclude((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  }

  async function downloadExport(nextFormat = format) {
    setDownloading(true);
    setLastDigest(null);
    try {
      const query = new URLSearchParams({ format: nextFormat });
      query.set("layout", layout);
      if (projectId) query.set("projectId", projectId);
      if (start) query.set("start", start);
      if (end) query.set("end", end);
      if (userId.trim()) query.set("userId", userId.trim());
      if (status) query.set("status", status);
      if (source) query.set("source", source);
      if (include.length !== DATASETS.length) query.set("include", include.join(","));

      const response = await fetch(`/api/export/csv?${query.toString()}`);
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || "Export failed");
      }
      const digest = response.headers.get("x-billabled-export-sha256");
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const suffix = selectedProjectName ? selectedProjectName.toLowerCase().replace(/[^a-z0-9]+/g, "-") : "workspace";
      a.href = url;
      a.download = `billabled-${suffix}-${today()}.${nextFormat}`;
      a.click();
      URL.revokeObjectURL(url);
      setLastDigest(digest);
      toast.success("Export generated", { description: digest ? `SHA-256 ${digest.slice(0, 16)}...` : undefined });
    } catch (error) {
      toast.error("Could not export data", { description: error instanceof Error ? error.message : "Unknown error" });
    } finally {
      setDownloading(false);
    }
  }

  return (
    <main className="min-h-screen bg-[#f6f3ee] p-4 text-slate-950 sm:p-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <header className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-sm font-bold uppercase tracking-[0.25em] text-cyan-700">Export center</p>
              <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">Complete and filtered data exports</h1>
              <p className="mt-2 max-w-2xl text-sm text-slate-500">Download complete workspace backups or filtered project, date, member, status, and source exports in CSV or JSON. Every export includes a SHA-256 digest header.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button onClick={() => { setFormat("csv"); downloadExport("csv"); }} disabled={downloading} className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 shadow-sm hover:border-cyan-300 hover:text-cyan-700 disabled:opacity-50"><FileSpreadsheet className="h-4 w-4" />CSV</button>
              <button onClick={() => { setFormat("json"); downloadExport("json"); }} disabled={downloading} className="inline-flex items-center gap-2 rounded-full bg-slate-950 px-4 py-2 text-sm font-bold text-white shadow-sm hover:bg-slate-800 disabled:opacity-50"><FileJson className="h-4 w-4" />JSON</button>
            </div>
          </div>
        </header>

        <section className="grid gap-6 lg:grid-cols-[0.95fr_1.05fr]">
          <div className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm">
            <div className="mb-5 flex items-center gap-3"><Filter className="h-5 w-5 text-cyan-700" /><h2 className="text-xl font-semibold">Filters</h2></div>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="text-sm font-bold text-slate-700">Format<select value={format} onChange={(event) => setFormat(event.target.value as ExportFormat)} className="mt-1 h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm outline-none focus:border-cyan-500"><option value="json">JSON backup</option><option value="csv">CSV spreadsheet</option></select></label>
              <label className="text-sm font-bold text-slate-700">Layout<select value={layout} onChange={(event) => setLayout(event.target.value as ExportLayout)} className="mt-1 h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm outline-none focus:border-cyan-500"><option value="detailed">Detailed rows</option><option value="summary">Summarized hours</option></select></label>
              <label className="text-sm font-bold text-slate-700">Project<select value={projectId} onChange={(event) => setProjectId(event.target.value)} className="mt-1 h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm outline-none focus:border-cyan-500"><option value="">All projects</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label>
              <label className="text-sm font-bold text-slate-700">Start<input type="date" value={start} onChange={(event) => setStart(event.target.value)} className="mt-1 h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm outline-none focus:border-cyan-500" /></label>
              <label className="text-sm font-bold text-slate-700">End<input type="date" value={end} onChange={(event) => setEnd(event.target.value)} className="mt-1 h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm outline-none focus:border-cyan-500" /></label>
              <label className="text-sm font-bold text-slate-700">Person<select value={userId} onChange={(event) => setUserId(event.target.value)} className="mt-1 h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm outline-none focus:border-cyan-500"><option value="">All people</option>{people.map((person) => <option key={person.id} value={person.linkedUserId || ""}>{person.displayName || person.email || "Unnamed member"}</option>)}</select></label>
              <label className="text-sm font-bold text-slate-700">Entry status<select value={status} onChange={(event) => setStatus(event.target.value)} className="mt-1 h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm outline-none focus:border-cyan-500"><option value="">Any status</option><option value="draft">Draft</option><option value="submitted">Submitted</option><option value="approved">Approved</option><option value="invoiced">Invoiced</option></select></label>
              <label className="text-sm font-bold text-slate-700 sm:col-span-2">Source<select value={source} onChange={(event) => setSource(event.target.value)} className="mt-1 h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm outline-none focus:border-cyan-500"><option value="">Any source</option><option value="timer">Timer</option><option value="manual">Manual</option><option value="calendar">Calendar</option><option value="scheduled">Scheduled plan-linked time</option></select></label>
            </div>
          </div>

          <div className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm">
            <div className="mb-5 flex items-center gap-3"><Archive className="h-5 w-5 text-cyan-700" /><h2 className="text-xl font-semibold">Datasets</h2></div>
            <div className="grid gap-2 sm:grid-cols-2">
              {DATASETS.map((dataset) => (
                <label key={dataset.id} className="flex cursor-pointer items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-700 transition hover:border-cyan-200 hover:bg-cyan-50">
                  <input type="checkbox" checked={include.includes(dataset.id)} onChange={() => toggleDataset(dataset.id)} className="h-4 w-4 accent-cyan-700" />
                  {dataset.label}
                </label>
              ))}
            </div>
            <div className="mt-5 rounded-3xl border border-cyan-100 bg-cyan-50 p-4 text-sm text-cyan-900">
              <div className="flex items-start gap-3"><ShieldCheck className="mt-0.5 h-5 w-5 shrink-0" /><div><p className="font-bold">Integrity headers stay on exports.</p><p className="mt-1">The API returns <code>x-billabled-export-sha256</code> so exported payloads can be verified later.</p></div></div>
              <p className="mt-3 text-xs text-cyan-900">{layout === "summary" ? "Summary CSV groups hours by day, person, project, status, and source." : "Detailed CSV exports one row per time entry."}</p>
              {lastDigest && <p className="mt-3 break-all font-mono text-xs">Last digest: {lastDigest}</p>}
            </div>
          </div>
        </section>

        <section className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h2 className="text-xl font-semibold">{completeExport ? "Complete workspace export" : "Filtered export"}</h2>
              <p className="mt-1 text-sm text-slate-500">{completeExport ? "All core datasets are selected with no project, member, status, or source filters." : "Filters are active. Export output will be scoped to the selected criteria."}</p>
            </div>
            <button onClick={() => downloadExport(format)} disabled={downloading || include.length === 0} className="inline-flex items-center justify-center gap-2 rounded-2xl bg-cyan-600 px-5 py-3 text-sm font-bold text-white transition hover:bg-cyan-500 disabled:opacity-50">
              <Download className="h-4 w-4" />
              {downloading ? "Generating..." : `Download ${format.toUpperCase()}`}
            </button>
          </div>
        </section>
      </div>
    </main>
  );
}
