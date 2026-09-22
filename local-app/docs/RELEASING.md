# macOS 发布

版本统一维护在 `local-app/package.json`、`src-tauri/Cargo.toml`、`src-tauri/tauri.conf.json`。三者必须一致；发布脚本会校验。不要用 Git 提交数做版本，也不要覆盖旧版本产物。

## 本机预览

```sh
yarn install --frozen-lockfile
yarn workspace excalidraw-local release --preview
```

预览包仅带本机 ad-hoc 资源签名，未使用 Developer ID 签名或苹果公证；不会自动退出、替换或启动现有 App。输出位于 `dist-release/<版本>/preview/<架构>/`。

所有发布（包括预览）都要求固定的更新签名私钥。该密钥与 Apple 证书独立，用于客户端验证更新包来源。本机脚本默认读取 `~/.config/excalidraw-local/release/updater.key`，也可通过 `TAURI_SIGNING_PRIVATE_KEY` 传入私钥内容，通过 `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` 传入其密码。私钥目录权限 0700、文件权限 0600；私钥不进入 Git。**请另做安全备份，不要在每次发布时重新生成密钥**，否则已安装的 App 将无法验证后续更新。

App 中只包含公钥，位于 `src-tauri/tauri.conf.json` 的 `plugins.updater.pubkey`。图稿和 GitHub 登录凭据不会参与更新检查。

## 固定证书签名与苹果公证

需要 Apple Developer Program 的 **Developer ID Application** 证书及其私钥。普通 Apple Development 证书、自签名证书、临时签名都不能代替 Developer ID 公证。

1. 把同一套 Developer ID Application 证书和私钥保存在 macOS 钥匙串，另做加密备份。私钥不进入 Git。
2. 使用 `xcrun notarytool store-credentials excal-release` 在钥匙串建立公证凭据（Apple ID、Team ID、App 专用密码）；不要把密码写进脚本或日志。
3. 设定 `APPLE_SIGNING_IDENTITY` 为该证书的完整名称或 SHA-1 指纹，`APPLE_NOTARY_PROFILE=excal-release`。若凭据位于独立钥匙串，另设 `APPLE_NOTARY_KEYCHAIN` 为该钥匙串绝对路径（CI 已配置）。
4. 运行 `yarn workspace excalidraw-local release`。脚本先检查证书，执行类型检查、前端/CLI/Rust 测试；校验 Node SHA-256，签名内置 Node 和 App；公证、装订 App；创建 DMG；再签名、公证、装订 DMG。

缺少身份或公证凭据时，正式发布直接失败，不会悄悄退回未签名包。Node 使用 Apple Silicon / Intel 原生版本；macOS 最低版本为 12.0，内置 Node 二进制的最低目标为 macOS 11.0。

## GitHub Actions

仓库 Environment `macos-release` 保存以下 Secrets：

| Secret | 内容 |
| --- | --- |
| `APPLE_CERTIFICATE` | 同一套 Developer ID Application 的 .p12 文件，base64 编码 |
| `APPLE_CERTIFICATE_PASSWORD` | .p12 导出密码 |
| `APPLE_SIGNING_IDENTITY` | 证书完整名称或指纹 |
| `KEYCHAIN_PASSWORD` | CI 临时钥匙串密码 |
| `APPLE_ID` | 公证 Apple ID |
| `APPLE_TEAM_ID` | 开发者 Team ID |
| `APPLE_APP_PASSWORD` | Apple ID 的 App 专用密码 |
| `TAURI_SIGNING_PRIVATE_KEY` | 固定的 Tauri 更新签名私钥内容，与 App 内公钥对应 |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | 更新私钥的密码；未加密密钥可留空 |

版本更新后执行检查并提交，再创建与版本一致的标签，例如 `v0.2.0`。工作流分别在 Apple Silicon 和 Intel runner 构建，两者都通过才创建 Release。重复发布同一个标签会失败，避免用户下载到同版本不同内容。

`v0.2.0-preview` 这类测试标签不触发签名发布。测试包可以放到标明未签名的 GitHub prerelease，不能当作公证正式版。

每个 Release 都含：

- `Excalidraw-Local-macOS-arm64.dmg`
- `Excalidraw-Local-macOS-x64.dmg`
- `SHA256SUMS`
- 每个架构的 `release.json`（版本、commit、签名/公证状态、校验和）
- 每个架构的 `.app.tar.gz` 自动更新包及 `.sig` 签名
- `latest.json` 更新清单；双架构 CI 完成后合并两种平台配置再上传

固定的正式版下载链接：

- `https://github.com/Stubsx/excalidraw-local/releases/latest/download/Excalidraw-Local-macOS-arm64.dmg`
- `https://github.com/Stubsx/excalidraw-local/releases/latest/download/Excalidraw-Local-macOS-x64.dmg`

仓库现已公开，源码使用 MIT 许可证，下载无需 GitHub 登录。上面的 `latest` 链接仅指向正式 Release；预览版从 Releases 页面下载。

## 应用内自动更新

App 使用无需授权的 GitHub Releases API 读取本项目最新 100 条发布记录，过滤草稿并按语义版本比较。设置中可关闭自动检查或预览版。当前预览阶段默认接收预览版；启动 5 秒后检查一次，此后每 6 小时检查。失败只在更新区域提示，不打断绘图。

每个版本的更新清单放在自己的 Release 中，客户端从该版本的 `latest.json` 读取对应 CPU 架构的下载 URL 和签名。清单、下载包只接受本项目的 HTTPS Release 地址；官方 Tauri updater 在安装前校验固定公钥签名。旧 Release 没有更新清单时显示手动下载入口。相同或更低版本不会安装。

用户点击“更新并重启”后，App 下载并验证完整更新包、保存当前画布与标签会话，再安装重启。任一步骤失败均保留当前工作台并允许重试。直接在 DMG 内运行时会提示先移入“应用程序”。更新仅替换 App 本身，资料库继续保存在用户目录；已有技能使用原来的 App 路径。

发布脚本在 Apple 签名/公证完成后生成更新压缩包，然后使用固定更新密钥签名。不要从签名之前的中间产物生成更新包。手动发布预览时，需要同时上传输出目录中的 DMG、`.app.tar.gz`、`.sig`、`latest.json`、`SHA256SUMS` 和 `release.json`，并使用 `v<版本>-preview` 标签。旧版本的文件保持不变。

0.2.6 及更早版本没有内置更新器，需要先手动安装一次 0.2.7 或更高版本。

## 技能打包

技能源在 `skill/excalidraw-local/`，随 App 分发。App 安装器只写入用户选中的目录，不读取客户端凭据。通用目录是 `~/.agents/skills`；另提供 Codex 兼容目录 `~/.codex/skills`、Claude Code、Kimi、ZCode 独立目录。

内置 Node 的版本和两种架构校验和固定于 `runtime-manifest.json`。升级时从 nodejs.org 官方发布页面核对并更新；构建脚本下载后再次验证 SHA-256。终端和技能都调用内置运行环境，用户不需要安装 Node、npm 或 Python。
