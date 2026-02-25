-- 在 notebookgo 库中执行，确保 postgres 对 public 下所有表有完整权限（解决 INSERT 报错）
-- 用法: psql -U postgres -d notebookgo -f packages/db/scripts/grant-postgres.sql

GRANT ALL ON SCHEMA public TO postgres;
GRANT ALL ON ALL TABLES IN SCHEMA public TO postgres;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO postgres;
ALTER TABLE IF EXISTS "notebooks" OWNER TO postgres;
ALTER TABLE IF EXISTS "sources" OWNER TO postgres;
ALTER TABLE IF EXISTS "source_chunks" OWNER TO postgres;
ALTER TABLE IF EXISTS "conversations" OWNER TO postgres;
ALTER TABLE IF EXISTS "messages" OWNER TO postgres;
ALTER TABLE IF EXISTS "notes" OWNER TO postgres;
