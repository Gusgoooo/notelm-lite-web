# Supabase 初始化（NotebookGo）

## 1) 在 Supabase 执行项目 SQL
1. 打开 Supabase 项目 -> `SQL Editor`。
2. 新建 Query，把 `deploy/supabase/init_notebookgo.sql` 全量粘贴进去执行。
3. 执行后确认这些表存在：`users / notebooks / sources / source_chunks / conversations / messages / notes / app_settings`。

## 2) 配置 Vercel 生产环境变量
至少确保以下变量正确：
- `DATABASE_URL`（必须是 Supabase 外网连接串，且带 `sslmode=require`）
- `NEXTAUTH_SECRET`
- `NEXTAUTH_URL=https://notebookgo.vercel.app`（或你的正式域名）

## 3) 连接串格式（推荐）
```env
DATABASE_URL=postgresql://postgres.<project-ref>:<password>@aws-0-<region>.pooler.supabase.com:6543/postgres?sslmode=require
```

## 4) 常见失败原因
- 用了 `localhost`（Vercel 无法访问你的本机数据库）。
- 用了占位符 `<user>/<password>/<host>`。
- 少了 `sslmode=require`。
- 只建了部分表，缺少 `users`。
