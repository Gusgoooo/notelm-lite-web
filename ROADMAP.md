# NotebookGo 产品路线图

在 [README.md](./README.md) 的 Roadmap 基础上，本文档细化后续里程碑与优先级，用于对齐「类 NotebookLM」的体验目标。

---

## 当前已完成

- MVP：笔记本 → 上传 PDF/Word → Worker 解析/分块/嵌入 → RAG 对话 + 引用
- Word 支持（Mammoth.js）
- 引用：折叠/展开、相似度分数、完整内容展示

---

## 下一阶段：生成能力 + Agent 配置（建议顺序）

目标：通过**可配置的生成 Agent**，根据用户意图生成 **PPT、信息图/结构图、纯图**，并支持后台配置「生图规则」与「Agent 角色定义」，全面靠拢 NotebookLM 的「从笔记到多形态输出」流程。

### 里程碑 D：生成 Agent 后台与意图路由

| 项 | 说明 |
|----|------|
| **后台配置：预设 Agent** | 在后台（或配置文件中）定义多种「生成 Agent」：如 `ppt_agent`、`infographic_agent`、`image_agent`。每个 Agent 包含：名称、描述、适用意图关键词、调用哪种生成工具（PPT / 信息图 / 纯图）、以及生图/生成规则（如尺寸、风格、结构化程度）。 |
| **意图识别与路由** | 根据用户输入（或对话上下文）判断意图（做 PPT / 要信息图 / 要配图），选择对应 Agent，再调用下游工具。可用 LLM 做意图分类，或关键词 + 规则。 |
| **数据模型** | 新增表或配置存储 Agent 定义（id、name、type: ppt \| infographic \| image、prompt_template、options 等），便于后续扩展。 |

### 里程碑 E：接入生成工具（PPT / 信息图 / 生图）

| 输出类型 | 可选方案 | 说明 |
|----------|----------|------|
| **PPT** | [pptxgenjs](https://github.com/gitbrent/PptxGenJS)（开源）、或 Google Slides API / 其他 API | 用 RAG 内容 + 大纲生成幻灯片；Agent 负责「规则」（每页要点数、是否带图、版式）。 |
| **信息图 / 结构图** | **nano banana**（你提到的方案）、或 [Mermaid](https://mermaid.js.org/)（图转图）、[D3](https://d3js.org/)、或「结构化描述 → 生图 API」 | 用 RAG 提炼的结构/关系生成信息图或结构图；Agent 定义风格与图表类型（流程图、层级图等）。若「nano banana」指具体服务/产品，可在此层对接其 API。 |
| **纯图（配图）** | **Gemini 生图（nano banana）**：经 OpenRouter，模型为 **`google/gemini-3-pro-image-preview`**；或 DALL·E、Stable Diffusion 等 | 根据段落或摘要生成配图；Agent 定义尺寸、风格、安全策略。接入时使用 OpenRouter 同一 API，生图路由为 `google/gemini-3-pro-image-preview`。 |

建议实现顺序：**先做 1 种类型打通闭环**（例如先做「信息图/结构图」或「纯图」），再扩展 PPT、网页生成等。

### 里程碑 F：与对话/笔记流程整合（类 NotebookLM）

- 在 Chat 或笔记中：用户说「帮我做成信息图」/「生成一页 PPT」/「给这段配图」→ 走意图路由 → 选 Agent → 调用工具 → 返回结果（图或 PPT 链接/预览）。
- 结果可插入到当前笔记或单独展示，并可重新编辑/重新生成。
- 可选：简单「网页生成」能力（用 RAG 内容生成单页 HTML），用开源模板或 Markdown → HTML 即可，优先级可放在 PPT 之后。

---

## 关于「nano banana」与生图规则

- **nano banana** = **Gemini 的生图能力**，与 DALL·E 同属生图模型。经 **OpenRouter** 接入时，生图路由（model id）为：**`google/gemini-3-pro-image-preview`**。在里程碑 E 中作为「纯图/配图」的一种后端接入（与 DALL·E、Stable Diffusion 等并列可选）。
- **生图规则预设**：在后台配置中为每个 Agent 维护「生图规则」——例如尺寸、配色、风格；生成时由后端读取对应 Agent 配置，把规则注入到 prompt 或请求参数。
- **Agent 角色定义**：每个 Agent 可带一段「角色定义」文案（system prompt），用于 LLM 或生图 API 的风格控制；后台可编辑这些文案。

---

## 界面与体验优化：什么时候做？

建议**分两段**做，而不是等所有功能做完再统一做 UI：

### 1. 与当前开发并行（现在就可以开始）

- **小步优化**：统一 loading 状态、错误提示样式、按钮/输入框的 focus 与可访问性、移动端基础适配（如侧栏可收折）。
- **信息架构**：固定顶部或侧栏的「笔记本名 + 上传 + 设置」入口，保证「后台配置 Agent」有明确入口（例如设置页或 /admin）。
- 这样后续加「生成结果展示」「Agent 选择」时，不会在混乱的布局上堆功能。

### 2. 功能基本就绪后（里程碑 E/F 之后）

- **集中体验设计**：在「PPT / 信息图 / 纯图」都能从对话或笔记触发并看到结果后，做一轮**类 NotebookLM** 的体验收口：
  - 对话中直接展示生成的图/PPT 预览、一键插入笔记或导出。
  - 统一「引用 + 生成结果」的展示形式（卡片、缩略图、展开详情）。
  - 可选：引导流程（首次使用时的简短引导）、动效与过渡。
- 此时再考虑是否引入设计系统或 UI 库（如 Radix、shadcn）做统一组件，会更有方向。

**总结**：现在就可以做**轻量级界面优化**和**后台配置入口**；**大一点的 UX 与视觉打磨**建议放在「生成 Agent + 至少一种生成工具」跑通之后，这样改界面时有完整场景可依。

---

## 建议的下一步（可直接开工）

1. **里程碑 D**：设计 Agent 数据模型（表或 config schema）+ 后台配置页（列表/编辑 Agent，含名称、类型、规则、角色定义）。
2. **里程碑 E**：选一种生成类型先做——例如**信息图/结构图**（对接 nano banana 或 Mermaid/生图 API），实现「用户意图 → 选 Agent → 调接口 → 返回图」。
3. **界面**：在现有三栏布局上，加「设置」或「管理」入口，并统一 loading/错误样式；为后续「生成结果」预留展示区域（如对话下方或右侧面板）。

**OpenRouter 生图（nano banana）**：使用与聊天相同的 `OPENROUTER_API_KEY` 与 `OPENROUTER_BASE_URL`，生图模型为 **`google/gemini-3-pro-image-preview`**，实现时按 OpenRouter 图像生成接口传入该 model 即可。

---

## 登录与多用户、何时部署在线服务器

- **登录系统**：已实现邮箱+密码注册/登录（NextAuth Credentials）、Session（JWT）、路由保护（未登录访问 `/` 会跳转 `/login`）。笔记本与当前用户绑定（`notebooks.user_id`），列表/创建/编辑/删除均按当前用户鉴权。
- **何时构建在线服务器 / 开放给更多用户**  
  - **不必等所有能力都做完再上线**。建议顺序：  
    1. **现在**：登录已就绪，数据已按用户隔离，本地或单机部署即可给少数人用（内测）。  
    2. **准备开放更多人时**：再部署到在线服务器（如 Vercel + 托管 Postgres/Redis，或自建 VPS），配置 `NEXTAUTH_URL` 为正式域名、HTTPS，并设置强随机 `NEXTAUTH_SECRET`。  
    3. **生成能力（Agent、PPT/信息图/生图）**：可以在上线后按里程碑 D/E/F 逐步迭代；先有「登录 + RAG + 笔记」即可开放，再陆续加生成与体验优化。  
  - **结论**：不需要等「上述能力全部构建完成」再上线。登录与多用户已就绪，随时可部署；生成与体验可在上线后继续做。
