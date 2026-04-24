import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const requiredFiles = [
  "AGENTS.md",
  "CLAUDE.md",
  ".github/copilot-instructions.md",
  ".cursor/rules/billabled.mdc",
  "docs/agentic/README.md",
  ".codex/skills/billabled-development/SKILL.md",
  ".codex/skills/billabled-product-ux/SKILL.md",
  ".codex/skills/billabled-api-security/SKILL.md",
];

const requiredAgentPhrases = [
  "Next.js `16.2.0`",
  "workspaceId",
  "Plan work -> Track live timers -> Log manual/calendar time -> Review analytics -> Approve/invoice/export -> Integrate by API",
  "Stripe checkout accepts internal `planId` values only",
  "npm run lint",
  "npm run build",
];

function read(relativePath) {
  return readFileSync(join(root, relativePath), "utf8");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const failures = [];

for (const file of requiredFiles) {
  if (!existsSync(join(root, file))) failures.push(`Missing required agentic file: ${file}`);
}

if (existsSync(join(root, "AGENTS.md"))) {
  const agents = read("AGENTS.md");
  for (const phrase of requiredAgentPhrases) {
    if (!agents.includes(phrase)) failures.push(`AGENTS.md is missing required phrase: ${phrase}`);
  }
}

for (const file of ["CLAUDE.md", ".github/copilot-instructions.md", ".cursor/rules/billabled.mdc"]) {
  if (existsSync(join(root, file)) && !read(file).includes("AGENTS.md")) {
    failures.push(`${file} must delegate to AGENTS.md`);
  }
}

const skillsRoot = join(root, ".codex/skills");
if (existsSync(skillsRoot)) {
  for (const skillName of readdirSync(skillsRoot)) {
    const skillDir = join(skillsRoot, skillName);
    if (!statSync(skillDir).isDirectory()) continue;
    const skillPath = join(skillDir, "SKILL.md");
    if (!existsSync(skillPath)) {
      failures.push(`Skill ${skillName} is missing SKILL.md`);
      continue;
    }
    const skill = readFileSync(skillPath, "utf8");
    const frontmatter = skill.match(/^---\n([\s\S]*?)\n---\n/);
    if (!frontmatter) {
      failures.push(`Skill ${skillName} is missing YAML frontmatter`);
      continue;
    }
    const yaml = frontmatter[1];
    const name = yaml.match(/^name:\s*(.+)$/m)?.[1]?.trim();
    const description = yaml.match(/^description:\s*(.+)$/m)?.[1]?.trim();
    if (!name) failures.push(`Skill ${skillName} is missing frontmatter name`);
    if (!description) failures.push(`Skill ${skillName} is missing frontmatter description`);
    if (name && !/^[A-Za-z0-9-]+$/.test(name)) failures.push(`Skill ${skillName} has invalid name: ${name}`);
    if (description && !description.startsWith("Use when")) failures.push(`Skill ${skillName} description must start with "Use when"`);
    if (description && description.length > 500) failures.push(`Skill ${skillName} description is too long`);
    if (!skill.includes("# ")) failures.push(`Skill ${skillName} is missing a heading`);
  }
} else {
  failures.push("Missing .codex/skills directory");
}

try {
  assert(failures.length === 0, failures.join("\n"));
  console.log("Agentic files check passed.");
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
