---
name: excalidraw-local
description: 使用已安装的 Excalidraw Local 桌面 App 绘制、修改和渲染 .excalidraw 图，生成流程图、架构图、思维导图，并管理本地资料库。不用于修改 Excalidraw App 本身的代码。
---

# Excalidraw Local 绘图

使用本技能目录中的 `scripts/excal`（绝对路径调用）。App 自带 Node 和 CLI，不需要安装 npm、Python、浏览器扩展，也不需要配置 PATH。下面的 `$EXCAL` 代表该脚本的绝对路径；命令参数里的路径都应加引号。

## 工作流程

1. 确认是修改本地文件、库内已有图，还是新建图。修改已有文件前先备份；库内图先 `get` 导出并保留原件。
2. `.excalidraw` 是 JSON。优先使用 `gen` 的 mindmap/tree 模板，或按 [元素格式](references/elements.md) 修改元素。保留已有 id、绑定和未涉及内容，更新文本时同时更新 `originalText`。
3. 渲染 PNG，使用当前客户端的图像查看工具检查文本、箭头、换行和边界，再交付 `.excalidraw` 与 PNG。不要仅凭命令成功就认为视觉正确。
4. 用户要求修改库内图时，用同一 id 执行 `put` 回写。不要用 `import` 代替更新。

## 命令

```sh
"$EXCAL" local ls --format table
"$EXCAL" local get "唯一的场景ID" -o "/absolute/diagram.excalidraw"
"$EXCAL" local gen --spec-file "/absolute/spec.json" --template mindmap -o "/absolute/diagram.excalidraw"
"$EXCAL" local render "/absolute/diagram.excalidraw" -o "/absolute/diagram.png" --scale 2
"$EXCAL" local put "唯一的场景ID" --file "/absolute/diagram.excalidraw"
"$EXCAL" local import "/absolute/diagram.excalidraw" --name "架构图"
"$EXCAL" local mv "唯一的场景ID" --name "新名称"
"$EXCAL" local rm "唯一的场景ID"
```

CLI 最后一行输出 JSON 状态包络。失败时检查 `message`，不要盲目重试写操作。出现多个同名匹配时，先 `ls` 确认目标 id。删除及覆盖已有内容必须符合用户授权；不要自行使用 `--purge`。

`render` 自动启动 App，并等待本地渲染接口就绪。默认只生成 PNG，不写资料库。仅当用户要求存入资料库时使用 `import`；`render --save` 会按名称覆盖库内同名图，使用前应明确目标。

所有图和数据留在本机。App 在设置页安装这个技能及运行环境。若提示 App 路径失效，重新打开 App → 设置 → 更新技能；不要改用远程网站上传用户图稿。

## 生成规范

思维导图 spec：

```json
{
  "title": "规划",
  "root": { "label": "核心" },
  "branches": [
    { "label": "方向一", "children": ["步骤一", "步骤二"] },
    { "label": "方向二", "children": ["任务"] }
  ]
}
```

更多参数使用 `local gen --help`。复杂图应先确定内容层次与节点尺寸，再排列和连接。视觉检查发现遮挡或文字溢出时调整后重新渲染。
