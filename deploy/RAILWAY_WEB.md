# Railway 部署 Web

Web 依赖 monorepo 里的 `db` 和 `shared`，必须在**仓库根目录**安装并构建。

## 方式一：用 Dockerfile（推荐）

1. 在 Railway 的 **Web 服务**里：
   - **Builder** 选 **Dockerfile**
   - **Dockerfile Path** 填：`deploy/Dockerfile.web`
   - **Root Directory** 留空（不要填 `apps/web`）
2. 环境变量至少配置：
   - `DATABASE_URL`
   - `NEXTAUTH_SECRET`
   - `NEXTAUTH_URL`
   - 模型与存储变量（OpenRouter、S3 等）

## 方式二：用命令（Root 必须留空）

- **Build Command**：
  `pnpm install && pnpm --filter db build && pnpm --filter shared build && pnpm --filter web build`
- **Start Command**：
  `pnpm --filter web start`

若 Root 设为 `apps/web` 或只执行 `pnpm --filter web build`，会报 `Can't resolve 'db' / 'shared'`。
