<center>
  <h2>
    震荡分析池-nodejs版本
  </h2>
</center>

**Java 版本实现  ==> [smartpool](https://github.com/foreverchens/smartpool)**

### 0、一句话介绍

> 这是一个针对网格策略而设计的选币策略程序、可将币对的历史k线走势量化为一组震荡指标。

# 双币网格震荡分析平台（Codex 辅助说明）

本项目围绕 **Main.js**、**WebServer.js** 与 **view/home.html** 三个核心模块构建，实现了数据抓取、批次持久化，以及面向浏览器的直观可视化体验
。以下按角色说明它们的职责与相互协作方式，帮助快速理解项目结构与扩展点。
<img src="https://raw.githubusercontent.com/foreverchens/smartpool-nodejs/e526552b49bc1e406970625ce056bfcafc952495/icu/smartpool/common/home.png">

## Main.js — 批次调度与数据写入

- **批次调度器**：`run()` 负责触发一轮完整的数据抓取与分析流程。首次启动后根据剩余待处理的币对数量决定下一次执行的延迟（未处理完时 1 分钟，处理完则 1 小时）。
- **分批提速**：使用 `symbolBatchLength` 控制每轮处理的币对上限，起始为 2，每轮成功后 +2，直至覆盖全部；该机制平衡了 API 速率限制与实时性。
- **线程池驱动**：通过 `Piscina` 将每个 symbol 投递给 `service/worker.js`，并在多个阶段（`symbolList`、`rltArr`、`centerList`、`highList`、`lowList`、`highLowList`、`data`）保存中间结果。
- **量化周期持久化**：将 `config.CYCLE` 转换为 `cycleHours` 与 `cycleDays` 写入 `latest.json`，所有后端/前端组件即可一致引用该关键参数。

## WebServer.js — 数据服务层

- **统一读取**：`loadBatch()` 解析 `data/latest.json`，兼容直接写入阶段对象与历史结构，自动补齐 `lastSavedAt`、`cycleHours`、`cycleDays` 等字段。
- **REST 接口**：
    - `/api/data` 返回当前批次概览（阶段列表、保存时间、量化周期）。
    - `/api/data/<stage>`（如 `symbol-list`、`pairs`）返回指定阶段的数据、批次时间、量化周期。
- **静态资源**：托管 `view` 目录并默认将根路由重定向至 `home.html`。

## view/home.html — 浏览端可视化

- **布局**：标题区、阶段选择器、概览卡片（展示阶段、批次时间、量化周期、币对数量），侧边币对列表与主图表区构成完整页面。
- **数据加载**：
    - 初始化时先获取 `/api/data/symbol-list`、`/api/data/pairs`，解析基础清单与最终周期信息。
    - 使用 `populateStageOptions()` 拉取整体概览，再按需要调用 `/api/data/<stage>` 渲染每个阶段的符号列表与简介卡片。
    - 通过 `cachedCycleMeta` 缓存服务器返回的周期，在阶段切换或重新加载时仍保持正确展示。
- **交互特性**：
    - 支持手动输入/点击币对查看 K 线，并基于 `ECharts` 绘制蜡烛图、震荡档位等辅助标记。
    - “初始币对列表”“双币币对列表”会显示最新更新时间，便于监控数据是否同步。

## 快速开始

```bash
npm install
node icu/smartpool/Main.js      # 触发批次抓取并生成 latest.json
node icu/smartpool/WebServer.js    # 启动本地服务：http://localhost:3000
```

当 `Main.js` 正常运行时，可在浏览器访问 `http://localhost:3000/` 查看最新的双币震荡分析结果，并在顶部概览中确认量化周期（默认 28 天 / 672 小时）。若需调整批次周期或展示策略，可直接在 `common/Config.js` 与上述三个文件中扩展逻辑。
