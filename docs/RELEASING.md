# 发布流程（Beta 与 1.0）

> 面向维护者：把当前工作区变成一次公开发布的清单。命令都在仓库根目录执行。
>
> **本文件的主线是 Linux（完全版 / ACP 版、Arch 包、deb / rpm / AppImage / 便携二进制），那是 `AGENTS.md` 指定的目标平台。** 原有 Linux 打包链有 CI 覆盖，Arch 包仍需在 Arch 环境单独验收。Windows 便携版是另一条线，历史上是主要交付物，
> 现在没有 CI 覆盖，其流程保留在 §7 作为附录。

仓库采用单一 `main` 分支。发布前所有本地提交先合并到 `main`，再创建版本 tag 并推送；不要为发布保留长期功能分支。发布产物只从通过门禁的 `main` 提交生成。

## 1. 版本号（4 个文件 + 变更日志）

| 文件 | 字段 |
| --- | --- |
| `package.json` | `version` |
| `apps/desktop/package.json` | `version` |
| `apps/desktop/src-tauri/tauri.conf.json` | `version`（**打包脚本用它决定产物文件名**：`scripts/package-linux.sh:7`） |
| `apps/desktop/src-tauri/Cargo.toml` | `[package] version`（改完构建一次，让 `Cargo.lock` 同步） |

- `CHANGELOG.md`：`## [Unreleased]` 在第 5 行，`## [1.0.0] - 2026-08-29` 已存在（第 413 行）。
  所以**不要**按旧流程把 `## [Unreleased]` 改名成 `## [1.0.0]`——那会撞上已经发布的条目。
  1.0 之后的改动继续留在 `## [Unreleased]`，发布时改成下一个版本号；只有确实要修订 1.0.0 本身，
  才去动那一条并在条目里写明修订了什么。
- 界面版本号不是硬编码：`apps/desktop/src/ui/StatusBar.vue` 通过
  `apps/desktop/src/platform/app-version.ts` 读构建版本（打包版问 Tauri 的 `getVersion()`，
  浏览器与单测回落到 vite 注入的 `__APP_VERSION__`）。

## 2. 门禁（全绿才打包）

一条命令就是全部门禁（`.github/workflows/ci.yml` 的两个 job 与它逐步对应）：

```bash
bash scripts/gate.sh --with-e2e
```

它依次跑 `verify`（`pnpm verify`：typecheck、lint、三个包的 vitest、perf、renderer 构建、
`check:export-css`）、`cargo fmt --all --check`、`cargo clippy --all-targets --locked`（带告警上限）、
三个 Python instrument、两个 shell 套件、WebKit harness 测试、`tauri build --no-bundle`、
`NEKOWITE_REQUIRE_PROCESS_TESTS=1 cargo test`，最后是 Playwright。**任一步失败退出码为 1**，
且每一步都会跑完再汇总。`--only <名字逗号分隔>` 只跑子集。

要手工照抄 CI 的话，`check` job 的顺序是：`pnpm install --frozen-lockfile`、`pnpm typecheck`、`pnpm lint`、
三个 instrument、`sudo apt-get install -y rpm`、两个 shell 套件、`pnpm --filter @nekowite/desktop test:webkit-harness`、
`pnpm test`、`pnpm perf`、`pnpm --filter @nekowite/desktop build`、`… check:export-css`、
`… exec playwright install --with-deps chromium`、`pnpm test:e2e`；`rust` job 是 `cargo test --locked`、
`cargo build --locked`、`cargo clippy --all-targets --locked`、`cargo fmt --all --check`。
两者合起来和 `scripts/gate.sh --with-e2e` 覆盖的范围基本相同，但有两处**已知不同**，都来自 e2e：
root 的 `pnpm test:e2e` 直接调 playwright（端口固定 1420），而 gate 里的 e2e 走 `pnpm e2e`，由
`scripts/run-e2e.mjs` 先要一个空闲端口；另外 CI 的 `cargo test --locked` **没有**设
`NEKOWITE_REQUIRE_PROCESS_TESTS=1`，因为 CI 不构建也不暂存应用与引擎（`scripts/gate.sh` 里那两步），
所以需要真实进程的用例在 CI 上是跳过而不是失败——发布前请以 gate 的结果为准。
**打包脚本自己只跑 desktop 的 test / typecheck / lint**（`scripts/package-linux.sh:35-39`），Rust 侧、
instrument 与 e2e 都不在其中，所以先跑 §2 的命令，再打包。

**一个必须说清楚的边界**：`verify` 与 `e2e` 里的浏览器测试跑在 Playwright 的 Chromium 上，
而应用实际用的是 WebKitGTK（Linux）/ WebView2（Windows）。仓库自己的
`apps/desktop/e2e/webkit/webdriver.mjs` 写明了 Playwright 的 `webkit` 是它自己的构建、不是 GTK 移植版。
所以门禁全绿**不等于**「发货的那个引擎没问题」：真正测那个引擎的办法是
`apps/desktop/e2e/webkit/` 这套 harness（`node e2e/webkit/measure.mjs --only <探针>`），
它需要 WebKitWebDriver 与 MiniBrowser，是**手动**工具，不在门禁里。

## 3. 打包（Linux）

### 完全版与 ACP 版

先构建当前平台的 release 二进制，再运行对应发行脚本。ACP AppImage 必须在 `package:linux` 构建完整 AppDir 后生成：

```bash
pnpm --filter @nekowite/desktop exec tauri build --no-bundle
pnpm package:portable:full  # release/nekowite_<version>_x64，旁边必须有 release/opencode
pnpm package:portable:acp   # release/nekowite-acp_<version>_x64-standalone，不附带引擎
pnpm package:arch:full      # release/nekowite-full-<version>-1-x86_64.pkg.tar.zst
pnpm package:arch:acp       # release/nekowite-<version>-1-x86_64.pkg.tar.zst
```

ACP 版的应用 ELF 可以作为单个可执行文件分发，但仍要求系统 GTK / WebKitGTK 依赖，并需要用户安装可执行的 ACP 智能体。完全版把 OpenCode 一同交付；便携版的应用 ELF 本身并不包含引擎。Arch 脚本必须在提供 `makepkg` 和 `pacman` 的环境中运行，以预先生成的 `release/nekowite_<version>_x64` 为输入，完整包还读取旁边的 `release/opencode`；两种 Arch 包互相冲突，不能同时安装。`package:portable:acp` 原子替换同名 ACP 单文件，上传时只选择该文件。

### deb / rpm / AppImage

```bash
pnpm package:linux        # 即 bash scripts/package-linux.sh
pnpm test:package:appimage-acp
pnpm package:appimage:acp # 从本次集成 AppDir 构建 ACP AppImage
```

脚本自己会走七步，失败即停（`set -euo pipefail`，并用 flock 拒绝并发的第二次运行）：

1. `[1/7]` 校验待打入的引擎：`bash scripts/verify-opencode-linux.sh`。
2. `[2/7]`–`[3/7]` desktop 的测试与 typecheck / lint。
3. `[4/7]` `tauri build` 一次产出 deb、rpm、AppImage；AppImage 用缓存的 type2 runtime。
   **这一步在容器和这台机器上会遇到三个环境坑，脚本自己吸收**（2026-09-22 实测，三者互相独立）：
   `linuxdeploy` 自己就是一个 AppImage，没有 `/dev/fuse` 时它会死；它自带的 `strip` 早于 `.relr.dyn`
   （binutils 2.36+），在本发行版上 strip 系统库时报 `unknown type [0x13] section '.relr.dyn'`；而
   tauri 给随包引擎重链 `$ORIGIN/../lib` 时会给这个 176 MB 的 sidecar 加一个加载器无法消化的 LOAD
   段，产物 `--version` 直接 core dump、`ldd` 无声退出 1，linuxdeploy 于是报 `Failed to run ldd`。
   脚本的做法：`APPIMAGE_EXTRACT_AND_RUN=1`（自解压运行）、`NO_STRIP=1`（AppImage 因此大 0.9 MB）、
   以及恢复分支里用 `patchelf --set-rpath` 给**未打过补丁的** pinned 引擎重新链接后端到端重建 AppImage
   （重建前先运行一次 `--version` 确认能跑）。deb 与 rpm 不受第三个坑影响。
4. `[5/7]` 把**本次构建的**产物暂存到 `release/.candidate.XXXXXX/`：便携二进制
   `nekowite_<version>_x64`、引擎 `opencode`、以及三个包。
5. `[6/7]` 校验引擎：暂存的 `opencode` 必须与
   `apps/desktop/src-tauri/binaries/opencode-x86_64-unknown-linux-gnu` 逐字节相同，
   且每个包解开后引擎同样通过 `verify-opencode-linux.sh --bundle`。
6. `[7/7]` 校验第三方声明：每个包解开后的 `copyright`（deb / AppImage）或
   `THIRD-PARTY-NOTICES.txt`（rpm）必须与 `src-tauri/THIRD-PARTY-NOTICES.txt` 逐字节相同，
   且以 `END OF THIRD-PARTY NOTICES` 结尾。
7. 发布（这一步没有编号）：逐个改名到 `release/`，**先前的同名产物先备份到
   `release/superseded/build.XXXXXX/`**（任何一次改名失败都会把上一代恢复回来），
   最后对每个发布的文件打印 `sha256sum`。

`package:linux` 生成自带 OpenCode 的 deb、rpm 和 AppImage，以及完全版便携 ELF 与 OpenCode sidecar。完成后运行 `pnpm test:package:appimage-acp` 和 `pnpm package:appimage:acp`，从已验证的完整 AppDir 额外生成不带 OpenCode 的 ACP AppImage。ACP 镜像在独立临时 AppDir 中构建，并解包确认 sidecar 缺失。

这条流程的产物（`release/`，已在 `.gitignore` 里，不入库）：

| 文件 | 用途 |
| --- | --- |
| `nekowite_<version>_x64` | 完全版便携二进制，需与 `opencode` 同目录 |
| `nekowite-acp_<version>_x64-standalone` | 不附带 OpenCode 的单个应用 ELF |
| `opencode` | 内置智能体引擎，**必须与便携二进制放在同一目录** |
| `nekowite-<arch-version>-1-x86_64.pkg.tar.zst` | Arch ACP 安装包，beta 版本的连字符按 Arch 规则规范化为点 |
| `nekowite-full-<arch-version>-1-x86_64.pkg.tar.zst` | Arch 完全版安装包 |
| `nekowite_<version>_amd64.deb` | Debian / Ubuntu 安装包 |
| `nekowite-<version>-1.x86_64.rpm` | Fedora / RHEL 安装包 |
| `nekowite_<version>_amd64.AppImage` | 免安装单体 |
| `nekowite_<version>_amd64-acp.AppImage` | 不附带 OpenCode 的免安装 ACP 单体 |

**为什么要强调引擎和便携二进制放在一起**：便携产物不是自包含的，应用启动智能体时会去找同目录的
`opencode`。只复制 `nekowite_<version>_x64` 一个文件，装出来的应用其他功能都正常、只有智能体面板起不来
——这是这个仓库最典型的「开发树是绿的、包是坏的」，而且**真的发生过**：
`b14e2de fix(package): the portable executable shipped without its engine` 就是为它补的 37 行。
`[6/7]` 的存在就是为了让这件事在发布前失败，而不是在用户机器上失败。

## 4. 签名现状

- **Linux 包（含 Arch 包）没有 GPG 签名。** 这是 Linux 侧真正的缺口：无论用哪种方式分发，用户都无法验证
  包确实来自这里；仓库目前也没有发布公钥的位置。要补的话，需要先决定密钥托管与公钥分发方式。
- **Windows 二进制没有 Authenticode 签名**（`tauri.conf.json` 的 `bundle` 里没有 `windows` 签名配置，
  `scripts/package-win.sh` 也没有签名步骤）——见 §7。
- 无论哪一侧，**发布说明里都要写清楚签名现状**，不要留给用户自己发现。

## 5. 记录 SHA-256

- `scripts/package-linux.sh` 在最后对 `release/` 里每个产物执行 `sha256sum`，把输出抄下来。
- 建议同时写进发布说明与 `CHANGELOG.md` 对应条目（仓库里有先例：`b4bb816 docs: pin the verified
  portable exe hash`）。
- 分发时只发布 `release/` 里的产物。
- 源码以 GitHub Release 对应的 `v<version>` tag 为准，发布前核对 tag 与附件来自同一次构建。

## 6. 人工验收（自动化覆盖不到）

在一台干净机器上，用 deb 或 AppImage 各装一次：

1. AppImage：`chmod +x nekowite_<version>_amd64.AppImage && ./nekowite_<version>_amd64.AppImage`；
   deb：`sudo apt install ./nekowite_<version>_amd64.deb` 后从应用菜单启动。
2. 打开一个测试文件夹作为知识库；新建、编辑、`Ctrl+S` 保存，重启确认内容还在。
3. 删除一篇笔记 → 回收站恢复；连续保存几次 → 历史版本可对比并恢复。
4. 导出 HTML 与 PDF（PDF 走系统打印对话框）。
5. 打开智能体面板，确认内置引擎能起来（这一步验证的正是 §3 里那个「引擎必须在旁边」的条件）。
6. 配置本地模型（默认 `http://localhost:1234/v1`），验证 Tab 续写、聊天、选区改写；
   关掉「启用 AI 功能」后确认不再发请求；设置 → AI →「最近的 AI 活动」有记录且不含正文。
7. 确认知识库里出现 `.nekowite/`，删除笔记后出现 `.nekowite-trash/`；
   数据目录 `~/.local/share/dev.nekowite.app/.nekowite/stronghold.bin` 存在且非明文。
8. 退出应用；确认没有残留的 `nekowite` 进程。

## 7. 附录：Windows 便携版（历史路径，当前不受 CI 覆盖）

```bash
bash scripts/package-win.sh                 # 便携版：release/nekowite_<version>_x64.exe
PORTABLE=0 bash scripts/package-win.sh      # NSIS 安装包：release/nekowite_<version>_x64-setup.exe
```

- 脚本先用 `node -p` 读 `tauri.conf.json` 的 version 拼出文件名，构建前 `taskkill` 掉旧版本进程。
- 未签名时 Windows SmartScreen 会拦截（「Windows 已保护你的电脑」），需要「更多信息 → 仍要运行」；
  复核方式是在 PowerShell 里对**刚构建出来的那个 exe** 运行
  `Get-AuthenticodeSignature <路径>`，未签名时 `Status` 为 `NotSigned`。
- 这条路径产出的 `.exe` 不在 `release/` 里（本机只构建 Linux 产物），所以上面的命令必须用你自己
  刚生成的路径，而不是抄一个示例文件名。
- 引擎由 `tauri.conf.json` 的 `bundle.externalBin` 声明（`:35`），必须随应用一起分发；
  `scripts/package-win.sh` 对此没有任何校验（它不出现 `opencode` 这个词），所以 Windows 侧的
  这一条只能人工确认：产物旁边应当有 `opencode.exe`。

## 8. 待决事项（不是工程工作）

- **Linux 包的 GPG 签名**：见 §4；需要先决定密钥托管与公钥分发。
- **Windows 代码签名证书**（OV/EV、时间戳服务）：见 §7；拿到证书后在 `bundle.windows` 里配置证书
  指纹或自定义签名命令。
- **自动更新端点**：当前没有更新检查（没有 updater 插件、没有端点）。若要发布后可自动升级，
  需要先决定托管位置与更新签名密钥。
- **macOS 构建**：图标资源已包含 `.icns`，但仓库没有对应的打包脚本，也没有 CI；需要单独的流水线。
- **许可证**：MIT 的 `LICENSE` **已经提交**（`git ls-files LICENSE` 有它），两个 `package.json` 也写了
  `"license": "MIT"`；这项工作只剩在发布说明里确认。
