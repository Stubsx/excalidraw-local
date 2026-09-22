# 应用图标

`Excalidraw.icon` 是 Apple Icon Composer 可编辑源文件。白色底板与紫色手绘标识分层，前景 SVG 复用项目 `public/favicon.svg` 中的品牌路径并重新设置留白。

使用 Icon Composer 打开并保存源文件后，在仓库根目录执行：

```sh
yarn workspace excalidraw-local icons:generate
```

需要 macOS 和带 Icon Composer 的 Xcode（当前资源使用 Xcode 27 的 `actool` 生成）。脚本使用 Apple 官方编译器生成原生 `Assets.car` 和完整尺寸 `icon.icns`，再生成 Tauri 所需的 PNG、ICO 及其他平台资源。macOS 的留白、圆角和光学尺寸由编译器处理。

提交源文件及生成的 `src-tauri/icons/` 资源。常规打包直接使用已提交的资源，无需重新生成图标。`Info.plist` 的 `CFBundleIconName` 指向资源目录内的 Excalidraw 图标；新系统使用原生分层外观，旧系统使用白底 ICNS。不要只替换 PNG，否则 Dock 和 Finder 可能仍使用旧资源。
