import {
  pgTable,
  pgEnum,
  text,
  timestamp,
  integer,
  boolean,
  jsonb,
  uuid,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql, relations } from "drizzle-orm";

export const ticketStatus = pgEnum("ticket_status", [
  "open",
  "pending",
  "solved",
  "closed",
]);

export const messageDirection = pgEnum("message_direction", [
  "inbound",
  "outbound",
  "note",
]);

export const agentRole = pgEnum("agent_role", ["agent", "admin"]);

/* ------------------------------------------------------------------ people */

export const agents = pgTable(
  "agents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull(),
    name: text("name").notNull(),
    role: agentRole("role").notNull().default("agent"),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [uniqueIndex("agents_email_key").on(sql`lower(${t.email})`)],
);

export const teams = pgTable(
  "teams",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [uniqueIndex("teams_slug_key").on(t.slug)],
);

export const agentTeams = pgTable(
  "agent_teams",
  {
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    teamId: uuid("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
  },
  (t) => [uniqueIndex("agent_teams_key").on(t.agentId, t.teamId)],
);

export const tags = pgTable(
  "tags",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    color: text("color").notNull().default("slate"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [uniqueIndex("tags_slug_key").on(t.slug)],
);

/* ----------------------------------------------------------------- tickets */

export const ticketNumberSeq = sql`nextval('ticket_number_seq')`;

export const tickets = pgTable(
  "tickets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    number: integer("number").notNull().default(sql`nextval('ticket_number_seq')`),
    subject: text("subject").notNull().default("(no subject)"),
    status: ticketStatus("status").notNull().default("open"),
    requesterEmail: text("requester_email").notNull(),
    requesterName: text("requester_name"),
    assigneeId: uuid("assignee_id").references(() => agents.id, {
      onDelete: "set null",
    }),
    teamId: uuid("team_id").references(() => teams.id, { onDelete: "set null" }),
    gmailThreadId: text("gmail_thread_id"),
    lastMessageAt: timestamp("last_message_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("tickets_number_key").on(t.number),
    index("tickets_gmail_thread_idx").on(t.gmailThreadId),
    index("tickets_status_idx").on(t.status),
    index("tickets_updated_idx").on(t.updatedAt),
    index("tickets_last_message_idx").on(t.lastMessageAt),
  ],
);

export const ticketTags = pgTable(
  "ticket_tags",
  {
    ticketId: uuid("ticket_id")
      .notNull()
      .references(() => tickets.id, { onDelete: "cascade" }),
    tagId: uuid("tag_id")
      .notNull()
      .references(() => tags.id, { onDelete: "cascade" }),
  },
  (t) => [uniqueIndex("ticket_tags_key").on(t.ticketId, t.tagId)],
);

/* ---------------------------------------------------------------- messages */

export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ticketId: uuid("ticket_id")
      .notNull()
      .references(() => tickets.id, { onDelete: "cascade" }),
    direction: messageDirection("direction").notNull(),
    /** Gmail API message id. Unique — this is what makes ingestion idempotent. */
    gmailMessageId: text("gmail_message_id"),
    /** RFC 5322 Message-ID header, e.g. <abc@mail.gmail.com>. */
    rfcMessageId: text("rfc_message_id"),
    inReplyTo: text("in_reply_to"),
    references: jsonb("references").$type<string[]>().notNull().default([]),
    fromEmail: text("from_email").notNull(),
    fromName: text("from_name"),
    toEmails: jsonb("to_emails").$type<string[]>().notNull().default([]),
    ccEmails: jsonb("cc_emails").$type<string[]>().notNull().default([]),
    subject: text("subject"),
    bodyText: text("body_text"),
    bodyHtml: text("body_html"),
    /** Set for internal notes and portal replies. */
    authorAgentId: uuid("author_agent_id").references(() => agents.id, {
      onDelete: "set null",
    }),
    sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("messages_gmail_message_id_key").on(t.gmailMessageId),
    uniqueIndex("messages_rfc_message_id_key").on(t.rfcMessageId),
    index("messages_ticket_idx").on(t.ticketId, t.sentAt),
  ],
);

export const attachments = pgTable(
  "attachments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    messageId: uuid("message_id")
      .notNull()
      .references(() => messages.id, { onDelete: "cascade" }),
    filename: text("filename").notNull(),
    contentType: text("content_type"),
    size: integer("size"),
    blobUrl: text("blob_url").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("attachments_message_idx").on(t.messageId)],
);

/* ------------------------------------------------------------------ events */

export const events = pgTable(
  "events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ticketId: uuid("ticket_id")
      .notNull()
      .references(() => tickets.id, { onDelete: "cascade" }),
    actorAgentId: uuid("actor_agent_id").references(() => agents.id, {
      onDelete: "set null",
    }),
    /** assigned | unassigned | status | team | tag_added | tag_removed | created | reopened */
    kind: text("kind").notNull(),
    data: jsonb("data").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("events_ticket_idx").on(t.ticketId, t.createdAt)],
);

/* -------------------------------------------------------------- gmail sync */

/** Single-row table (one connected mailbox), but keyed by email so it can grow. */
export const gmailSync = pgTable("gmail_sync", {
  email: text("email").primaryKey(),
  refreshTokenEnc: text("refresh_token_enc").notNull(),
  labelId: text("label_id"),
  lastHistoryId: text("last_history_id"),
  watchExpiration: timestamp("watch_expiration", { withTimezone: true }),
  lastPushAt: timestamp("last_push_at", { withTimezone: true }),
  lastSyncAt: timestamp("last_sync_at", { withTimezone: true }),
  lastError: text("last_error"),
  connectedAt: timestamp("connected_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/* --------------------------------------------------------------- relations */

export const ticketRelations = relations(tickets, ({ one, many }) => ({
  assignee: one(agents, {
    fields: [tickets.assigneeId],
    references: [agents.id],
  }),
  team: one(teams, { fields: [tickets.teamId], references: [teams.id] }),
  messages: many(messages),
  ticketTags: many(ticketTags),
  events: many(events),
}));

export const messageRelations = relations(messages, ({ one, many }) => ({
  ticket: one(tickets, {
    fields: [messages.ticketId],
    references: [tickets.id],
  }),
  author: one(agents, {
    fields: [messages.authorAgentId],
    references: [agents.id],
  }),
  attachments: many(attachments),
}));

export const attachmentRelations = relations(attachments, ({ one }) => ({
  message: one(messages, {
    fields: [attachments.messageId],
    references: [messages.id],
  }),
}));

export const ticketTagRelations = relations(ticketTags, ({ one }) => ({
  ticket: one(tickets, {
    fields: [ticketTags.ticketId],
    references: [tickets.id],
  }),
  tag: one(tags, { fields: [ticketTags.tagId], references: [tags.id] }),
}));

export const eventRelations = relations(events, ({ one }) => ({
  ticket: one(tickets, { fields: [events.ticketId], references: [tickets.id] }),
  actor: one(agents, {
    fields: [events.actorAgentId],
    references: [agents.id],
  }),
}));

export const agentRelations = relations(agents, ({ many }) => ({
  agentTeams: many(agentTeams),
}));

export const agentTeamRelations = relations(agentTeams, ({ one }) => ({
  agent: one(agents, { fields: [agentTeams.agentId], references: [agents.id] }),
  team: one(teams, { fields: [agentTeams.teamId], references: [teams.id] }),
}));

export type Ticket = typeof tickets.$inferSelect;
export type Message = typeof messages.$inferSelect;
export type Agent = typeof agents.$inferSelect;
export type Team = typeof teams.$inferSelect;
export type Tag = typeof tags.$inferSelect;
export type TicketEvent = typeof events.$inferSelect;
export type GmailSync = typeof gmailSync.$inferSelect;
