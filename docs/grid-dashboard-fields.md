# 网格任务统计面板字段说明

本文档基于 `icu/smartpool/view/grid-dashboard.html` 的实现，说明页面上每个指标的含义、计算方式与数据来源，方便运营与开发对照使用。

## 1. 数据来源与预处理

- **订单数据**：`../grid/data/orders.json`。加载后会调用 `normalizeOrders`：
    - 生成 `price`、`quantity`（origQty）、`notional = price × quantity`；
    - 归一化时间戳 `updateTime`，保留有限值；
    - 计算手续费拆分：`makerFee = txFee × makerParticipation`，`takerFee = txFee - makerFee`；
    - 补充 `makerParticipation`（按百分比字段自动转为 0~1 区间）。
- **网格任务配置**：`../grid/data/grid_tasks.json`。`normalizeGridTasks` 负责：
    - 标准化字段（任务 ID、状态、币对、网格参数）；
    - 提取运行时快照（持仓数量、最新成交价等）。
- **聚合过程**（`buildTaskHierarchy`）：
    - 以 `taskId` 为维度累加订单，拆分买/卖金额、手续费、Maker 参与度等；
    - 同步按 `taskBindId` 聚合套利批次，并区分买腿、卖腿订单；
    - `computeRealizedMetrics` 负责对买卖均价、匹配数量和已实现利润做二次计算。
- **数据合并**（`mergeGridTasksWithStats`）：
    - 把已有订单统计与网格配置按任务 ID/币对对齐；
    - 生成 `assetStats`（币对级统计）和补充套利批次的币对映射，供 UI 展示使用。

所有数值最终通过 `formatNumber`、`formatPercent`、`formatDate` 统一格式化：默认保留 4 位小数，百分比以百分号显示，时间为
`YYYY-MM-DD HH:mm:ss`。

## 2. 页面结构字段说明

### 2.1 顶部区域

- **最后更新**：刷新页面时由 `updateMeta` 写入当前系统时间。
- **返回分析平台**：静态跳转链接。
- **任务选择器**：展示所有任务 ID（附带币对别名），变更时触发 `updateSelectedTaskId` 重新渲染。

### 2.2 网格任务概览卡片（Selected Task Overview）

> 来源：`renderSelectedTaskOverview`，数据对象为当前选中任务。

基础信息行：

- **任务**：`task.taskId`。
- **币对**：优先使用网格配置中的 `baseAsset / quoteAsset`；否则列出统计中涉及的交易对。
- **状态**：`formatGridStatus(gridTask.status)`，内部映射表把各类状态归并到“运行中 / 已暂停 / 已结束 / 异常 / 待启动”等中文标签。
- **网格间距 / 单格金额**：来自配置的 `gridRate`、`gridValue`（有值时才显示）。
- **时间范围**：`formatDate(task.start)` 到 `formatDate(task.end)`，分别对应订单最早、最晚时间戳。

指标格（顺序即界面展示顺序）：

1. **累计已套利利润**：`task.realizedProfit`
    - 计算：对每个币对统计 `matchedQty = min(买入量, 卖出量)`，若买卖均价皆有效，利润 = `matchedQty × (平均卖价 - 平均买价)`
      ；再对任务下所有币对求和。
2. **净利润（扣手续费）**：`netProfit = task.realizedProfit - task.totalFee`；当任一分量缺失时显示 `-`。
3. **累计手续费**：`task.totalFee = Σ订单.txFee`。
4. **未平仓名义**：`task.netExposureNotional = buyNotional - sellNotional`，展示双币网格当前敞口，正值代表买侧持仓，负值代表卖侧持仓。
5. **Maker成交额占比**：`task.makerOrderRatio = makerNotional / participationNotional`。
6. **平均Maker参与度**：`task.makerParticipation = task.makerParticipationSum / task.makerParticipationCount`（加权平均）。
7. **订单总数**：`task.totalOrders = Σ订单数量`。
8. **套利次数**：`task.arbitrageCount = 当前任务的套利批次数（taskBindId 分组数）`。

> 提示：`Maker成交额占比` 关注的是成交名义金额中来自 Maker 的比例，而 `平均Maker参与度` 则以“单笔订单”为统计单位，反映平均每笔订单有多少比例以
> Maker 方式成交，两者互补。

底部还会补充：

- **资产成交概览**（见 2.3 节）。
- **时间范围标签**：同上方。
- 当缺少资产明细时，展示“暂无资产成交记录”占位。

### 2.3 资产成交概览（Asset Cards）

> 来源：`renderAssetCard`；数据来自 `assetStats = composeAssetStats(task.symbolStats, gridTask)`。

对每个币对生成一张卡片，头部显示：

- **币对**：资产符号。
- **已套利利润**：即卡片右上角徽章，取 `asset.realizedProfit`，颜色按照 `getProfitClass`（>0 绿色、<0 红色、近零中性）。

卡片网格中的字段及公式：
| 字段 | 含义 | 计算方式 |
| --- | --- | --- |
| 总买入量 | 累计买单数量 | `Σ订单(quantity)`，仅统计 `side === 'BUY'` |
| 总买入金额 | 买单名义金额 | `Σ订单(price × quantity)` |
| 平均买入价 | 名义平均价 | `buyNotional / buyQty`（买入量为 0 时返回 `-`） |
| 总卖出量 | 同上 | 仅统计 `side === 'SELL'` |
| 总卖出金额 | 同上 | |
| 平均卖出价 | 名义平均价 | `sellNotional / sellQty` |
| 价差 | 平均卖价 - 平均买价 | 仅当买卖均有成交时有效 |
| 已套利数量 | `matchedQty` | `min(buyQty, sellQty)` |
| 已套利利润 | `realizedProfit` | `matchedQty × (平均卖价 - 平均买价)` |
| 总手续费 | `totalFee` | 对应币对的手续费总和 |
| 当前持仓数量 | 未平仓手数 | `buyQty - sellQty` |
| 当前名义持仓 | 名义敞口估算 | `当前持仓数量 × 最新成交价`（无成交价时退回 `buyNotional - sellNotional`） |
| Maker成交额占比 | Maker 成交名义占比 | `makerNotional / participationNotional`（无有效值时显示 `-`） |

注意：手续费同样按买卖两侧累计，可通过 `makerFeeTotal`、`takerFeeTotal` 拆分（目前 UI 仅显示合计）。

### 2.4 任务批次列表（Task Hierarchy）

> 来源：`renderTaskHierarchy`，为当前任务或全部任务的折叠列表。

#### 2.4.1 标题区（summary）

标题行左侧展示状态徽章、任务 ID 与币对，右侧为指标卡片面板；网格参数与运行时数据会以标签（chip）形式并列显示。

- **状态徽章**：`formatGridStatus` 同 2.2。
- **币对**：任务涉及的所有交易对（`symbols.join('、')`）。
- **参数标签**（按需显示）：网格配置（如 `网格间距`、`单格金额`）、运行时持仓与汇率（`Base 0.06 / Quote 0.03` 形式、
  `下一买入汇率`、`下一卖出汇率`、`最新成交汇率`）。
- **套利批次**：`套利批次 N（完成 X / 未平 Y）`，其中未平 = `arbitrageCount - completedCount`。
- **最新成交时间**：`task.latestTrade`，若无有效值则显示 `-`。
- **时间范围**：`task.start` ~ `task.end`。

#### 2.4.2 右侧指标矩阵（task-metrics）

（已取消独立指标矩阵，相关字段合并至概览指标或标题区。）

#### 2.4.3 套利批次总表（arbitrage-table）

表头字段及来源：
| 列 | 含义 / 计算 |
| --- | --- |
| 批次ID | `taskBindId`（订单绑定批次号） |
| 交易汇率 | 优先显示 `arbitrage.synthPrice`（订单原始合成汇率） |
| 交易方向 | 基于套利“基准腿”方向（通常对应 Base 资产的买/卖）。 |
| 交易金额 (USDT) | 基准腿名义金额 `baseLeg.notional`。 |
| 交易总手续费 | 买卖腿手续费之和 `baseLeg.totalFee + quoteLeg.totalFee`。 |
| 状态 | `determineArbitrageStatus`：<br>• 买卖都有 → “已完成”<br>• 仅买单 → “待卖出”<br>• 仅卖单 → “待买入”<br>•
双侧都无 → “待交易” |
| 套利时间 | 基准腿起止时间。起始为 `baseLeg.earliest`（或批次最早订单时间），结束为 `baseLeg.latest`（或批次最晚）。 |

> 说明：原“已套利利润”列为名义差额统计，现已移除，避免与手续费或未平仓敞口混淆。

#### 2.4.4 批次明细（arbitrage-detail）

展开某批次后展示买卖腿订单明细，字段含义：
| 列 | 含义 / 计算 |
| --- | --- |
| 角色 | `Base` / `Quote`（或任务匹配到的币对腿）。 |
| 订单ID | `orderId` 优先；如无则用 `clientOrderId`。 |
| 方向 | `order.side` 原样展示（BUY/SELL）。 |
| 交易对 | `order.symbol`。 |
| 成交数量 | `quantity`，按 `normalizeOrders` 转换后保留 4 位。 |
| 成交价格 | `price`，保留 6 位。 |
| 成交金额 | `notional = price × quantity`。 |
| 手续费 | `txFee`。 |
| Maker占比 | 优先 `makerFeeRate` 原始字符串；否则使用 `makerParticipation` 百分比。 |
| 成交时间 | `formatDate(order.updateTime)`。 |

当某腿无订单时，显示“暂无订单”占位行。

### 2.5 最新成交列表（Latest Trades）

> 来源：`renderTimeline`，取当前任务订单按时间倒序的最近 10 条。

字段含义：

- **交易对**：`order.symbol`。
- **方向**：BUY/SELL，配合颜色徽章（绿=买，红=卖）。
- **成交数量 / 价格 / 金额**：与资产卡一致。
- **手续费**：单笔 `txFee`。
- **订单ID**：`order.orderId`，无则回退 `clientOrderId`。
- **Maker占比**：同批次明细。
- **状态**：订单原始状态字段（如 `FILLED`、`PARTIALLY_FILLED` 等）。
- **时间**：`updateTime`。
- **网格批次**：`taskBindId`，若无绑定显示 `-`。

### 2.6 数据源信息

底部“数据源”区：

- **正在加载…**：`updateMeta` 在请求开始时写入；
- **错误提示**：若其中任一 fetch 报错，会展示错误消息（HTTP 状态 + 文本）。

## 3. 数值格式与颜色规则

- **利润着色**：`getProfitClass` 根据数值正负返回 `profit-positive` / `profit-negative` / `profit-neutral`
  ，界面分别用绿色、红色、中性灰。
- **百分比**：输入值为 0~1 比例，展示时乘以 100 输出并附带 `%`。
- **空值处理**：非有限数（NaN、无值）统一显示 `-`，确保界面可读。
- **时间**：基于 JavaScript `Date`，若时间戳 ≤ 0 或非法，同样展示 `-`。

## 4. 追加说明

- 任务统计以订单的 `taskId` 为准；若 `grid_tasks.json` 中不存在该 ID，会以“未登记”状态展示，但统计仍然有效。
- `netExposureQty` / `netExposureNotional` 仅反映名义持仓，不考虑真实持仓方向（例如反向策略）；实际风险判断需结合策略语义。
- 若需要新增或修改指标，可在 `buildTaskHierarchy` 中补充原始聚合字段，并在前端相应位置映射展示。

如需进一步调试，可在浏览器打开控制台，调用 `dashboardState` 查看实时聚合结果。欢迎在文档基础上附加业务层描述或案例。
