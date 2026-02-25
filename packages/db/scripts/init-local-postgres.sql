-- 在本机 Postgres 上以超级用户执行（例如 macOS: psql -U $(whoami) postgres -f packages/db/scripts/init-local-postgres.sql）
-- 创建 postgres 用户并赋予超级用户权限，然后创建项目库（若 postgres 已存在可只执行 ALTER 和建库）

CREATE USER postgres WITH PASSWORD 'postgres';
ALTER ROLE postgres SUPERUSER;

CREATE DATABASE notebookgo OWNER postgres;

\c notebookgo
CREATE EXTENSION IF NOT EXISTS vector;
