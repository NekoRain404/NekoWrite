# 贡献指南

> 面向 NekoWite 的代码、文档与测试贡献。本文的命令都在仓库根目录用 Git Bash 执行；界面语言是中文，标识符（命令、路径、文件名）保持英文原样。

## 开发环境

| 依赖 | 版本 | 说明 |
| --- | --- | --- |
| Node.js | `>= 22` | `package.json` 的 `engines.node` |
| pnpm | 11（`packageManager` 固定为 `pnpm@11.1.1`） | 建议用 Corepack：`corepack enable` |
| Rust | stable + 对应 Tauri v2 系统依赖 | 只有开发桌面壳与 Rust 命令层时需要 |

```bash
git clone https://github.com/NekoRain404/NekoWrite.git
cd NekoWite
pnpm install

pnpm dev          # 浏览器开发模式（Vite）
pnpm tauri dev    # 完整桌面应用（Tauri + Rust）
```

## 提交前的质量门禁

以下是 CI（`.github/workflows/ci.yml`）检查的内容，请本地全部跑绿再开 PR。

```bash
pnpm -r typecheck   # 全工作区类型检查
pnpm -r lint        # ESLint
pnpm -r test        # Vitest 单元测试
```

Rust 命令层（在 `apps/desktop/src-tauri/` 下执行，或从根目录用 `--manifest-path apps/desktop/src-tauri/Cargo.toml`）：

```bash
cargo test --locked
cargo clippy --all-targets -- -D warnings
cargo fmt --all --check
```

```bash
pnpm -r build       # 桌面端生产构建
pnpm test:e2e       # Playwright 关键路径（首次需要 pnpm --filter @nekowite/desktop exec playwright install chromium）
```

说明：`cargo fmt --all --check` 与「clippy 无警告」在本仓库是硬要求；`bash scripts/package-win.sh` 只跑 desktop 的 test / typecheck / lint，Rust 的 test / clippy / fmt 需要你自己先跑过。

## 打包（Windows）

```bash
bash scripts/package-win.sh              # 免安装便携版 -> release/nekowite_<version>_x64.exe
PORTABLE=0 bash scripts/package-win.sh   # NSIS 安装包 -> release/nekowite_<version>_x64-setup.exe
```

- `release/` 在 `.gitignore` 里，产物不入库；脚本最后会打印产物的 SHA-256。
- 任何用户可见的改动都应当附带一个重新打包的便携版 exe；PR 里请说明是否重建。
- 版本号取自 `apps/desktop/src-tauri/tauri.conf.json`，改版本时四个文件要对齐（见 `docs/RELEASING.md`）。

## 提交信息

使用 Conventional Commits：`feat:`、`fix:`、`docs:`、`refactor:`、`test:`、`chore:`。

仓库的习惯是：标题写做了什么，正文解释**为什么**这么做——尤其是那些看起来绕、或者否掉了一条更直接路线的改动。

```text
fix(history): restoring a version now changes what is on screen

恢复到缓冲区后没有触发文档更新，界面还停在当前版本，用户会以为恢复失败。
这里改为走与打开文档同一条更新路径，而不是让恢复流程自己拼状态。
```

## 两个必须注意的坑

- **`.npmrc` 是故意被 gitignore 的。** registry 镜像属于每位开发者的网络选择，不是项目决定：提交一份就会把所有贡献者和 CI 都绑到第三方镜像上。中国大陆的贡献者可以自己建一份：

  ```ini
  registry=https://registry.npmmirror.com
  ```

- **`apps/desktop/ai-lab/` 是 gitignore 的，也必须保持这样。** 那里的真机验证探针里带着它们所连端点的**真实 API Key**（例如 `apps/desktop/ai-lab/211-live-ai.cjs`）。把这些文件提交上去就是把凭证泄露到 git 历史里——**不要**用 `git add -f`，**不要**把里面的 key 复制到任何被跟踪的文件、issue 或 PR 描述里。要复现真机检查，请自己在本地重建这份探针。

## 工作区地图

| 路径 | 内容 |
| --- | --- |
| `apps/desktop/` | Vue 3 应用与 Tauri 壳（含 Rust 命令层 `src-tauri/`） |
| `packages/editor-core/` | Markdown / MDX 编辑与序列化模型 |
| `packages/plugin-host/` | 插件加载、注册、权限确认与治理 |
| `docs/` | 文档索引：`dev.md`（开发与架构）、`SECURITY.md`（安全模型）、`RELEASING.md`（发布）、`PLUGIN_SDK.md` 与 `PLUGIN_ISOLATION.md`（插件）、`PRIVACY.md`（隐私） |

## 相关文档

- `docs/dev.md`：架构、目录约定与 Definition of Done
- `docs/RELEASING.md`：1.0 发布清单、门禁、打包与签名现状
- `docs/SECURITY.md`：安全边界「已强制 / 未实现」逐项清单
