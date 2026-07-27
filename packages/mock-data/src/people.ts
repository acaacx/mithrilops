import type { Repository, Team, User } from "@secureflow/types";

export const teams: Team[] = [
  { id: "team-payments", name: "Payments Engineering", businessUnit: "Financial Services" },
  { id: "team-web", name: "Digital Experience", businessUnit: "Customer" },
  { id: "team-identity", name: "Identity Platform", businessUnit: "Platform" },
  { id: "team-messaging", name: "Messaging & Events", businessUnit: "Platform" },
  { id: "team-data", name: "Data & Reporting", businessUnit: "Analytics" },
];

export const users: User[] = [
  { id: "u-rowan", name: "Rowan Ashford", email: "rowan.ashford@meridianbank.example", role: "devsecops-engineer", teamId: "team-payments", avatarInitials: "RA" },
  { id: "u-priya", name: "Priya Natarajan", email: "priya.natarajan@meridianbank.example", role: "security-engineer", teamId: "team-identity", avatarInitials: "PN" },
  { id: "u-marcus", name: "Marcus Oyelaran", email: "marcus.oyelaran@meridianbank.example", role: "platform-engineer", teamId: "team-payments", avatarInitials: "MO" },
  { id: "u-elin", name: "Elin Sørensen", email: "elin.sorensen@meridianbank.example", role: "release-approver", teamId: "team-web", avatarInitials: "ES" },
  { id: "u-tomas", name: "Tomás Herrera", email: "tomas.herrera@meridianbank.example", role: "developer", teamId: "team-web", avatarInitials: "TH" },
  { id: "u-aiko", name: "Aiko Tanaka", email: "aiko.tanaka@meridianbank.example", role: "compliance-reviewer", teamId: "team-data", avatarInitials: "AT" },
  { id: "u-derek", name: "Derek Mensah", email: "derek.mensah@meridianbank.example", role: "application-owner", teamId: "team-messaging", avatarInitials: "DM" },
];

export const repositories: Repository[] = [
  { id: "repo-payments", name: "meridian/payments-api", url: "https://github.com/meridian/payments-api", defaultBranch: "main", provider: "github" },
  { id: "repo-portal", name: "meridian/customer-portal", url: "https://github.com/meridian/customer-portal", defaultBranch: "main", provider: "github" },
  { id: "repo-identity", name: "meridian/identity-service", url: "https://github.com/meridian/identity-service", defaultBranch: "main", provider: "github" },
  { id: "repo-notify", name: "meridian/notification-worker", url: "https://github.com/meridian/notification-worker", defaultBranch: "main", provider: "github" },
  { id: "repo-reporting", name: "meridian/reporting-platform", url: "https://github.com/meridian/reporting-platform", defaultBranch: "main", provider: "github" },
];

export function userById(id: string): User {
  const user = users.find((u) => u.id === id);
  if (!user) throw new Error(`Unknown mock user: ${id}`);
  return user;
}
