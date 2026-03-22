CREATE TABLE "audit_logs" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"workspace_id" varchar(255) NOT NULL,
	"time_entry_id" varchar(255) NOT NULL,
	"actor_user_id" varchar(255) NOT NULL,
	"event_type" varchar(255) NOT NULL,
	"diff" jsonb NOT NULL,
	"signature" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "goals" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"workspace_id" varchar(255) NOT NULL,
	"project_id" varchar(255),
	"name" varchar(255) NOT NULL,
	"target_hours" real,
	"due_date" timestamp,
	"completed" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invitations" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"email" varchar(255) NOT NULL,
	"workspace_id" varchar(255) NOT NULL,
	"role" varchar NOT NULL,
	"invited_by_user_id" varchar(255) NOT NULL,
	"expires_at" integer NOT NULL,
	"accepted_at" integer
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"workspace_id" varchar(255) NOT NULL,
	"project_id" varchar(255),
	"number" varchar(255) NOT NULL,
	"amount" real NOT NULL,
	"status" varchar DEFAULT 'draft' NOT NULL,
	"due_date" timestamp,
	"time_entry_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lock_periods" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"workspace_id" varchar(255) NOT NULL,
	"period_start" timestamp NOT NULL,
	"period_end" timestamp NOT NULL,
	"reason" text NOT NULL,
	"locked_by_user_id" varchar(255) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "magic_links" (
	"token_id" varchar(255) PRIMARY KEY NOT NULL,
	"token_hash" varchar(255) NOT NULL,
	"email" varchar(255) NOT NULL,
	"workspace_slug" varchar(255) NOT NULL,
	"expires_at" integer NOT NULL,
	"used_at" integer
);
--> statement-breakpoint
CREATE TABLE "memberships" (
	"workspace_id" varchar(255) NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"role" varchar DEFAULT 'member' NOT NULL,
	CONSTRAINT "memberships_workspace_id_user_id_pk" PRIMARY KEY("workspace_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"workspace_id" varchar(255) NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"message" text NOT NULL,
	"read" boolean DEFAULT false NOT NULL,
	"related_entity_id" varchar(255),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_tasks" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"workspace_id" varchar(255) NOT NULL,
	"project_id" varchar(255) NOT NULL,
	"parent_id" varchar(255),
	"title" varchar(255) NOT NULL,
	"description" text,
	"status" varchar DEFAULT 'todo' NOT NULL,
	"position" real NOT NULL,
	"due_date" timestamp,
	"assignee_id" varchar(255),
	"estimated_hours" real,
	"blocked_by_task_ids" jsonb DEFAULT '[]'::jsonb,
	"attachments" jsonb DEFAULT '[]'::jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"workspace_id" varchar(255) NOT NULL,
	"name" varchar(255) NOT NULL,
	"billing_model" varchar DEFAULT 'hourly' NOT NULL,
	"percent_complete" real DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "time_entries" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"workspace_id" varchar(255) NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"task_id" varchar(255) NOT NULL,
	"project_id" varchar(255),
	"goal_id" varchar(255),
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"started_at" timestamp NOT NULL,
	"stopped_at" timestamp,
	"duration_seconds" real,
	"description" text,
	"action" varchar(255),
	"hourly_rate" real,
	"status" varchar DEFAULT 'draft' NOT NULL,
	"source" varchar DEFAULT 'web' NOT NULL,
	"collaborators" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"expenses" jsonb DEFAULT '[]'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_actions" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"workspace_id" varchar(255) NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"name" varchar(255) NOT NULL,
	"hourly_rate" real
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"email" varchar(255) NOT NULL,
	"display_name" varchar(255),
	"timezone" varchar(100) DEFAULT 'UTC' NOT NULL,
	"preferred_tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "webhooks" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"workspace_id" varchar(255) NOT NULL,
	"url" varchar(1024) NOT NULL,
	"events" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspaces" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"slug" varchar(255) NOT NULL,
	"name" varchar(255) NOT NULL,
	"base_currency" varchar(10) DEFAULT 'USD' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "workspaces_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goals" ADD CONSTRAINT "goals_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lock_periods" ADD CONSTRAINT "lock_periods_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_tasks" ADD CONSTRAINT "project_tasks_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_tasks" ADD CONSTRAINT "project_tasks_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_actions" ADD CONSTRAINT "user_actions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_actions" ADD CONSTRAINT "user_actions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhooks" ADD CONSTRAINT "webhooks_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;