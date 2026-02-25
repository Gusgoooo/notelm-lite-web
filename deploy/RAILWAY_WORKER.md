# Railway 部署 Worker

Worker 依赖 monorepo 里的 `db` 和 `shared`，必须在**仓库根目录**安装并构建。

## 方式一：用 Dockerfile（推荐，避免 Root/Build 配置错误）

1. 在 Railway 的 **Worker 服务**里：
   - **Settings** → **Build**（或 **Deploy**）：
     - **Builder** 选 **Dockerfile**
     - **Dockerfile Path** 填：`deploy/Dockerfile.worker`
   - **Root Directory** 留空（用整个仓库）
2. 环境变量照常配：`DATABASE_URL`、S3、`OPENROUTER_API_KEY` 等。

构建和启动由 Dockerfile 完成，不再依赖 Railway 的 Build/Start 命令。

## 方式二：用 pnpm 命令（需 Root 留空）

- **Root Directory**：**必须留空**，让 Railway 克隆整个仓库。
- **Build Command**：`pnpm install && pnpm --filter worker build`
- **Start Command**：`pnpm --filter worker start`
- **Environment**：与 Web 一致（`DATABASE_URL`、S3、OpenRouter 等）。

若 Root 被设为 `apps/worker`，会报找不到 `shared` / `db`，请改回留空或改用方式一。
