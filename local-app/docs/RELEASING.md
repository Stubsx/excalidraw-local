# macOS 发布

版本统一维护在 `local-app/package.json`、`src-tauri/Cargo.toml`、`src-tauri/tauri.conf.json`。三者必须一致；发布脚本会校验。不要用 Git 提交数做版本，也不要覆盖旧版本产物。

## 本机预览

```sh
yarn install --frozen-lockfile
yarn workspace excalidraw-local release --preview
```

预览包只用于测试，明确标记为未签名、未公证；不会自动退出、替换或启动现有 App。输出位于 `dist-release/<版本>/preview/<架构>/`。

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

版本更新后执行检查并提交，再创建与版本一致的标签，例如 `v0.2.0`。工作流分别在 Apple Silicon 和 Intel runner 构建，两者都通过才创建 Release。重复发布同一个标签会失败，避免用户下载到同版本不同内容。

`v0.2.0-preview` 这类测试标签不触发签名发布。测试包可以放到标明未签名的 GitHub prerelease，不能当作公证正式版。

每个 Release 都含：

- `Excalidraw-Local-macOS-arm64.dmg`
- `Excalidraw-Local-macOS-x64.dmg`
- `SHA256SUMS`
- 每个架构的 `release.json`（版本、commit、签名/公证状态、校验和）

固定的正式版下载链接：

- `https://github.com/Stubsx/excalidraw-local/releases/latest/download/Excalidraw-Local-macOS-arm64.dmg`
- `https://github.com/Stubsx/excalidraw-local/releases/latest/download/Excalidraw-Local-macOS-x64.dmg`

仓库是私有的，这些下载地址要求读权限。若要让任意人下载，后续单独建立公开的二进制发布仓库，不必公开源码。当前工作流不会自行更改仓库可见性。

## 技能打包

技能源在 `skill/excalidraw-local/`，随 App 分发。App 安装器只写入用户选中的目录，不读取客户端凭据。通用目录是 `~/.agents/skills`；另提供 Codex 兼容目录 `~/.codex/skills`、Claude Code、Kimi、ZCode 独立目录。

内置 Node 的版本和两种架构校验和固定于 `runtime-manifest.json`。升级时从 nodejs.org 官方发布页面核对并更新；构建脚本下载后再次验证 SHA-256。终端和技能都调用内置运行环境，用户不需要安装 Node、npm 或 Python。
