import {
  index,
  pgTable,
  text,
  timestamp,
  jsonb,
  integer,
  vector,
} from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: text('id').primaryKey(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  name: text('name'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const notebooks = pgTable(
  'notebooks',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('notebooks_user_idx').on(table.userId)]
);

export const sources = pgTable(
  'sources',
  {
    id: text('id').primaryKey(),
    notebookId: text('notebook_id')
      .notNull()
      .references(() => notebooks.id, { onDelete: 'cascade' }),
    filename: text('filename').notNull(),
    fileUrl: text('file_url').notNull(),
    mime: text('mime'),
    status: text('status', {
      enum: ['PENDING', 'PROCESSING', 'READY', 'FAILED'],
    })
      .notNull()
      .default('PENDING'),
    errorMessage: text('error_message'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('sources_notebook_idx').on(table.notebookId)]
);

export const sourceChunks = pgTable(
  'source_chunks',
  {
    id: text('id').primaryKey(),
    sourceId: text('source_id')
      .notNull()
      .references(() => sources.id, { onDelete: 'cascade' }),
    chunkIndex: integer('chunk_index').notNull(),
    content: text('content').notNull(),
    pageStart: integer('page_start'),
    pageEnd: integer('page_end'),
    embedding: vector('embedding', { dimensions: 1536 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('source_chunks_source_idx').on(table.sourceId),
    index('source_chunks_embedding_idx').using(
      'hnsw',
      table.embedding.op('vector_cosine_ops')
    ),
  ]
);

export const conversations = pgTable(
  'conversations',
  {
    id: text('id').primaryKey(),
    notebookId: text('notebook_id')
      .notNull()
      .references(() => notebooks.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('conversations_notebook_idx').on(table.notebookId)]
);

export const messages = pgTable(
  'messages',
  {
    id: text('id').primaryKey(),
    conversationId: text('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    role: text('role', { enum: ['user', 'assistant', 'system'] }).notNull(),
    content: text('content').notNull(),
    citations: jsonb('citations').$type<Array<{
      sourceId: string;
      sourceTitle: string;
      pageStart?: number;
      pageEnd?: number;
      snippet: string;
    }>>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('messages_conversation_idx').on(table.conversationId)]
);

export const notes = pgTable(
  'notes',
  {
    id: text('id').primaryKey(),
    notebookId: text('notebook_id')
      .notNull()
      .references(() => notebooks.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    content: text('content').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('notes_notebook_idx').on(table.notebookId)]
);

export const appSettings = pgTable('app_settings', {
  id: text('id').primaryKey(),
  openrouterApiKey: text('openrouter_api_key'),
  openrouterBaseUrl: text('openrouter_base_url').notNull().default('https://openrouter.ai/api/v1'),
  models: jsonb('models')
    .$type<{
      summary?: string;
      mindmap?: string;
      infographic?: string;
      webpage?: string;
    }>()
    .notNull()
    .default({}),
  prompts: jsonb('prompts')
    .$type<{
      summary?: string;
      mindmap?: string;
      infographic?: string;
      webpage?: string;
    }>()
    .notNull()
    .default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Notebook = typeof notebooks.$inferSelect;
export type NewNotebook = typeof notebooks.$inferInsert;
export type Source = typeof sources.$inferSelect;
export type NewSource = typeof sources.$inferInsert;
export type SourceChunk = typeof sourceChunks.$inferSelect;
export type NewSourceChunk = typeof sourceChunks.$inferInsert;
export type Conversation = typeof conversations.$inferSelect;
export type NewConversation = typeof conversations.$inferInsert;
export type Message = typeof messages.$inferSelect;
export type NewMessage = typeof messages.$inferInsert;
export type Note = typeof notes.$inferSelect;
export type NewNote = typeof notes.$inferInsert;
export type AppSettings = typeof appSettings.$inferSelect;
export type NewAppSettings = typeof appSettings.$inferInsert;
