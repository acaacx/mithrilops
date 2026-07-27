import Fastify from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import { z } from "zod";
import {
  applications,
  auditEvents,
  complianceFrameworks,
  deployments,
  infrastructurePlans,
  pipelineRuns,
  securityFindings,
  stageLogs,
} from "@secureflow/mock-data";
import { PIPELINE_RUN_STATUSES, ENVIRONMENTS } from "@secureflow/types";

/**
 * SecureFlow API scaffold. Serves the same mock dataset the SPA embeds, behind
 * the routes a production deployment would use. Real persistence (PostgreSQL +
 * Prisma), Redis, and Entra ID JWT validation slot into the marked extension
 * points; none of that is faked here.
 */
const app = Fastify({ logger: true });

await app.register(helmet, {
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      frameAncestors: ["'none'"],
    },
  },
});
await app.register(cors, {
  origin: process.env.CORS_ORIGIN ?? "http://localhost:5173",
});
await app.register(rateLimit, {
  max: Number(process.env.RATE_LIMIT_MAX ?? 200),
  timeWindow: "1 minute",
});

// Extension point: replace with Entra ID (OIDC) bearer-token validation.
// Every privileged route must additionally check role permissions server-side.
app.addHook("onRequest", async (req) => {
  req.log.debug({ url: req.url }, "auth hook (simulated — allow all in mock mode)");
});

const runsQuerySchema = z.object({
  applicationId: z.string().optional(),
  status: z.enum(PIPELINE_RUN_STATUSES).optional(),
  environment: z.enum(ENVIRONMENTS).optional(),
});

app.get("/health", async () => ({ status: "ok", mode: "mock" }));

app.get("/api/applications", async () => applications);

app.get("/api/applications/:id", async (req, reply) => {
  const { id } = z.object({ id: z.string() }).parse(req.params);
  const found = applications.find((a) => a.id === id);
  if (!found) return reply.code(404).send({ error: "application_not_found" });
  return found;
});

app.get("/api/runs", async (req, reply) => {
  const parsed = runsQuerySchema.safeParse(req.query);
  if (!parsed.success) return reply.code(400).send({ error: "invalid_query", detail: parsed.error.flatten() });
  let runs = pipelineRuns;
  const { applicationId, status, environment } = parsed.data;
  if (applicationId) runs = runs.filter((r) => r.applicationId === applicationId);
  if (status) runs = runs.filter((r) => r.status === status);
  if (environment) runs = runs.filter((r) => r.environment === environment);
  return runs;
});

app.get("/api/runs/:id", async (req, reply) => {
  const { id } = z.object({ id: z.string() }).parse(req.params);
  const run = pipelineRuns.find((r) => r.id === id);
  if (!run) return reply.code(404).send({ error: "run_not_found" });
  return run;
});

app.get("/api/runs/:id/stages/:stageId/logs", async (req, reply) => {
  const { id, stageId } = z.object({ id: z.string(), stageId: z.string() }).parse(req.params);
  const run = pipelineRuns.find((r) => r.id === id);
  if (!run) return reply.code(404).send({ error: "run_not_found" });
  return stageLogs(id, stageId);
});

app.get("/api/findings", async () => securityFindings);
app.get("/api/deployments", async () => deployments);
app.get("/api/plans", async () => infrastructurePlans);
app.get("/api/frameworks", async () => complianceFrameworks);
app.get("/api/audit", async () => auditEvents);

/**
 * Server-Sent Events stream of simulated pipeline activity. A production
 * implementation fans out real events from Redis pub/sub or a message bus.
 */
app.get("/api/events", async (req, reply) => {
  reply.raw.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  const send = (event: string, data: unknown) =>
    reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  send("hello", { message: "SecureFlow event stream connected (simulated)" });
  const timer = setInterval(() => {
    send("heartbeat", { at: new Date().toISOString() });
  }, 10_000);
  req.raw.on("close", () => clearInterval(timer));
  // Keep the connection open; Fastify must not try to serialize a body.
  return reply;
});

const port = Number(process.env.API_PORT ?? 4000);
const host = process.env.API_HOST ?? "127.0.0.1";
app
  .listen({ port, host })
  .then(() => app.log.info(`SecureFlow API listening on http://${host}:${port}`))
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
