## JSON 格式要点

### 元素通用字段

每个元素需要：`id`（随机字符串）、`type`、`x`、`y`、`width`、`height`、`angle`(0)、`strokeColor`、`backgroundColor`、`fillStyle`、`strokeWidth`、`strokeStyle`、`roughness`(1 为手绘感)、`opacity`(100)、`groupIds`([])、`frameId`(null)、`index`（z 序，如 `"bRB"`，同层级递增即可）、`seed`（随机整数）、`version`(1)、`versionNonce`（随机整数）、`isDeleted`(false)、`boundElements`([])、`updated`（毫秒时间戳）、`link`(null)、`locked`(false)。

改已有元素时只改内容字段即可，但建议同步 `version += 1`、换新 `versionNonce` 和 `updated`，避免协同缓存问题。

### 文本与容器

示意图的典型结构：rectangle/ellipse 容器 + 绑定的 text 元素。

- text 元素通过 `containerId` 指向容器；容器的 `boundElements` 里有 `{"id": <textId>, "type": "text"}`。
- **改文本时必须同步改 `originalText`**（与 `text` 保持一致），否则在网页里重新编辑时会回跳出旧内容。
- 文本不会自动重排。改完文本要手动维护尺寸和居中：
  - 宽度估算：CJK 字符 ≈ `fontSize` px/字，ASCII 数字/字母 ≈ 0.6–0.65 × `fontSize`，全角括号按 CJK 算。
  - 单行高度 ≈ `fontSize × 1.25`；多行用 `\n`，高度按行数累加。
  - 保持居中：`new_x = old_x + (old_width - new_width) / 2`；y 同理（容器内 `verticalAlign: middle`）。
  - 估算不必精确——网页端只在重新编辑文本时才重算，渲染时差一点看不出来；但宽度若超过容器宽度会触发换行，要留意。
- `fontFamily: 5` 是 Excalifont（常见默认），`fontSize` 常见 20/28。

### 箭头

arrow 的 `points` 是**相对于自身 x/y 的坐标**（如 `[[0,0],[-200,-185]]`），`width`/`height` 取绝对值。连接关系可用 `startBinding`/`endBinding`（`{"elementId":..., "focus":..., "gap":...}`），不绑定也能正常显示——简单图可以不绑定。
