export type WorkspaceRole = "member" | "manager" | "owner";

export type User = {
  id: string;
  email: string;
  displayName?: string;
  timezone: string;
  preferredTags: string[];
  createdAt: string;
};

export type Workspace = {
  id: string;
  slug: string;
  name: string;
  baseCurrency: string;
  createdAt: string;
};

export type Project = {
  id: string;
  workspaceId: string;
  name: string;
  billingModel: "hourly" | "fixed_fee" | "hybrid";
  percentComplete: number;
  createdAt: string;
};

export type Goal = {
  id: string;
  workspaceId: string;
  projectId?: string;
  name: string;
  targetHours?: number;
  dueDate?: string;
  completed: boolean;
  createdAt: string;
};

export type Membership = {
  workspaceId: string;
  userId: string;
  role: WorkspaceRole;
};

export type Invitation = {
  id: string;
  email: string;
  workspaceId: string;
  role: WorkspaceRole;
  invitedByUserId: string;
  expiresAt: number;
  acceptedAt: number | null;
};

export type MagicLinkRecord = {
  tokenId: string;
  tokenHash: string;
  email: string;
  workspaceSlug: string;
  expiresAt: number;
  usedAt: number | null;
};

export type TimeEntry = {
  id: string;
  workspaceId: string;
  userId: string;
  taskId: string;
  projectId?: string;
  goalId?: string;
  tags: string[];
  startedAt: string;
  stoppedAt: string | null;
  durationSeconds: number | null;
  description?: string;
  action?: string;
  hourlyRate?: number;
  status: "draft" | "submitted" | "approved" | "invoiced";
  source: "web" | "calendar" | "manual";
  collaborators: string[];
  expenses: Array<{ label: string; amount: number; currency: string; r2Key: string }>;
};

export type AuditItem = {
  id: string;
  workspaceId: string;
  timeEntryId: string;
  actorUserId: string;
  eventType: string;
  diff: Record<string, { before: unknown; after: unknown }>;
  signature: string;
  createdAt: string;
};

export type LockPeriod = { workspaceId: string; periodStart: string; periodEnd: string; reason: string; lockedByUserId: string };

export type UserAction = {
  id: string;
  workspaceId: string;
  userId: string;
  name: string;
  hourlyRate?: number;
};

export type KanbanColumn = "todo" | "in_progress" | "review" | "done";

export type ProjectTask = {
  id: string;
  workspaceId: string;
  projectId: string;
  parentId?: string;
  title: string;
  description?: string;
  status: KanbanColumn;
  position: number;
  dueDate?: string;
  assigneeId?: string;
  estimatedHours?: number;
  blockedByTaskIds?: string[];
  createdAt: string;
};

export type Notification = {
  id: string;
  workspaceId: string;
  userId: string;
  message: string;
  read: boolean;
  relatedEntityId?: string;
  createdAt: string;
};

type InMemoryDB = {
  users: Map<string, User>;
  usersByEmail: Map<string, string>;
  workspaces: Map<string, Workspace>;
  workspacesBySlug: Map<string, string>;
  projects: Map<string, Project>;
  goals: Map<string, Goal>;
  memberships: Membership[];
  invitations: Map<string, Invitation>;
  magicLinks: Map<string, MagicLinkRecord>;
  entries: Map<string, TimeEntry>;
  audits: AuditItem[];
  locks: LockPeriod[];
  dailySubmissions: Set<string>;
  timerStopCounters: Map<string, { windowStart: number; count: number }>;
  userActions: Map<string, UserAction>;
  tasks: Map<string, ProjectTask>;
  notifications: Map<string, Notification>;
};

declare global {
  var timelyStore: InMemoryDB | undefined;
}

function init(): InMemoryDB {
  return {
    users: new Map(),
    usersByEmail: new Map(),
    workspaces: new Map(),
    workspacesBySlug: new Map(),
    projects: new Map(),
    goals: new Map(),
    memberships: [],
    invitations: new Map(),
    magicLinks: new Map(),
    entries: new Map(),
    audits: [],
    locks: [],
    dailySubmissions: new Set(),
    timerStopCounters: new Map(),
    userActions: new Map(),
    tasks: new Map(),
    notifications: new Map(),
  };
}

export const store = globalThis.timelyStore ?? init();
globalThis.timelyStore = store;

export function ensureUser(email: string) {
  const normalized = email.trim().toLowerCase();
  const existingId = store.usersByEmail.get(normalized);
  if (existingId) return store.users.get(existingId)!;

  const user: User = {
    id: crypto.randomUUID(),
    email: normalized,
    timezone: "UTC",
    preferredTags: [],
    createdAt: new Date().toISOString(),
  };
  store.users.set(user.id, user);
  store.usersByEmail.set(normalized, user.id);
  return user;
}

export function ensureWorkspace(slug: string) {
  const normalized = slug.trim().toLowerCase();
  const existingId = store.workspacesBySlug.get(normalized);
  if (existingId) return store.workspaces.get(existingId)!;

  const workspace: Workspace = {
    id: crypto.randomUUID(),
    slug: normalized,
    name: normalized,
    baseCurrency: "USD",
    createdAt: new Date().toISOString(),
  };

  store.workspaces.set(workspace.id, workspace);
  store.workspacesBySlug.set(normalized, workspace.id);
  return workspace;
}

export function ensureMembership(userId: string, workspaceId: string, defaultRole: WorkspaceRole = "member") {
  const existing = store.memberships.find((item) => item.userId === userId && item.workspaceId === workspaceId);
  if (existing) return existing;

  const membership: Membership = { userId, workspaceId, role: defaultRole };
  store.memberships.push(membership);
  return membership;
}

export function getMembership(userId: string, workspaceId: string) {
  return store.memberships.find((item) => item.userId === userId && item.workspaceId === workspaceId) ?? null;
}

export function createProject(input: Omit<Project, "id" | "createdAt" | "percentComplete"> & { percentComplete?: number }) {
  const project: Project = {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    percentComplete: input.percentComplete ?? 0,
    ...input,
  };
  store.projects.set(project.id, project);
  return project;
}

export function createGoal(input: Omit<Goal, "id" | "createdAt" | "completed"> & { completed?: boolean }) {
  const goal: Goal = {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    completed: input.completed ?? false,
    ...input,
  };
  store.goals.set(goal.id, goal);
  return goal;
}

export function createInvitation(input: Omit<Invitation, "id" | "acceptedAt">) {
  const invitation: Invitation = { id: crypto.randomUUID(), acceptedAt: null, ...input };
  store.invitations.set(invitation.id, invitation);
  return invitation;
}

export function findPendingInvitation(email: string, workspaceId: string) {
  const normalized = email.trim().toLowerCase();
  const now = Date.now();
  return [...store.invitations.values()].find((invite) => {
    return invite.workspaceId === workspaceId && invite.email === normalized && !invite.acceptedAt && invite.expiresAt > now;
  }) ?? null;
}

export function listWorkspaceTags(workspaceId: string) {
  const tags = new Set<string>();
  for (const entry of store.entries.values()) {
    if (entry.workspaceId !== workspaceId) continue;
    for (const tag of entry.tags) {
      tags.add(tag);
    }
  }
  return [...tags].sort();
}

export function calculateEffectiveRate(userId: string, workspaceId: string, actionId: string): number | undefined {
  const action = store.userActions.get(actionId);
  if (action && action.workspaceId === workspaceId && action.userId === userId) {
    return action.hourlyRate;
  }
  return undefined;
}

export function createNotification(input: Omit<Notification, "id" | "createdAt" | "read">) {
  const notification: Notification = {
    id: crypto.randomUUID(),
    read: false,
    createdAt: new Date().toISOString(),
    ...input,
  };
  store.notifications.set(notification.id, notification);
  return notification;
}
