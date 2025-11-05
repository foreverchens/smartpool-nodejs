import {readFile, writeFile} from "fs/promises";
import path from "path";
import {fileURLToPath} from "url";
import czClient from "./common/CzClient.js";

// 分数达到该阈值时，才允许分配全部自动网格名额。
const SCORE_THRESHOLD = 20000;
// 自动创建的网格任务上限，用于限制风险敞口。
const MAX_TOP_COUNT = 2;
// 当信号不够强时，仅保留最优的若干个任务。
const FALLBACK_TOP_COUNT = 1;
// 允许的价格位置区间，确保策略在低位附近开仓。
const POSIT_MIN = 0;
const POSIT_MAX = 0.1;
// 自动任务默认使用的网格参数。
const GRID_RATE = 0.005;
const GRID_VALUE = 100;
const MAX_POSIT_CNT = 5;

// 解析真实路径，保证定时任务在不同入口下都能找到数据文件。
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "..");
const DATA_FILE = path.join(ROOT_DIR, "data", "latest.json");
const TASK_FILE = path.join(__dirname, "data", "grid_tasks.json");
// 内存中的自动任务索引，避免重复写入或并发冲突。
const autoTaskStore = new Set();

// 读取 JSON 配置，若文件缺失则返回默认值。
async function loadJson(filePath) {
    try {
        const raw = await readFile(filePath, "utf8");
        return JSON.parse(raw);
    } catch (err) {
        throw err;
    }
}

// 将 ETH-BTC 拆解成标准化的 base/quote。
function splitSymbol(symbol) {
    if (!symbol || typeof symbol !== "string" || !symbol.includes("-")) {
        return null;
    }
    const [base, quote] = symbol.split("-");
    if (!base || !quote) {
        return null;
    }
    return {base: base.trim().toUpperCase(), quote: quote.trim().toUpperCase()};
}

// 从最新周期结果中挑选最优的候选交易对。
function selectTopPairs(entries = []) {
    if (!Array.isArray(entries) || entries.length === 0) {
        return [];
    }
    const sorted = entries
        .filter(item => item && typeof item === "object" && Number.isFinite(item.score))
        .sort((a, b) => Number(b.score ?? 0) - Number(a.score ?? 0));
    if (!sorted.length) {
        return [];
    }
    const topScore = Number(sorted[0].score) || 0;
    const limit = topScore < SCORE_THRESHOLD ? FALLBACK_TOP_COUNT : MAX_TOP_COUNT;
    return sorted.slice(0, limit);
}

// 判断当前点位是否贴近区间下沿，避免追高。
function positIsNearLower(posit) {
    return typeof posit === "number" && posit > POSIT_MIN && posit < POSIT_MAX;
}

// 请求双币种的合约价格，为初始仓位估算提供真实报价。
async function fetchPairPrices(base, quote) {
    const baseSymbol = `${base}USDT`;
    const quoteSymbol = `${quote}USDT`;
    const [basePrice, quotePrice] = await Promise.all([czClient.getFuturesPrice(baseSymbol), czClient.getFuturesPrice(quoteSymbol)]);
    if (!Number.isFinite(basePrice) || basePrice <= 0) {
        throw new Error(`base price invalid for ${baseSymbol}`);
    }
    if (!Number.isFinite(quotePrice) || quotePrice <= 0) {
        throw new Error(`quote price invalid for ${quoteSymbol}`);
    }
    return {basePrice, quotePrice, baseSymbol, quoteSymbol};
}

// 根据行情+参数生成完整的网格任务描述。
function buildTask({base, quote, lowP, amp, basePrice, quotePrice, baseSymbol, quoteSymbol}) {
    const id = `${base}${quote}-auto`;
    const absAmp = Math.abs(Number(amp) || 0);
    const startPrice = Number(lowP);
    if (!Number.isFinite(startPrice) || startPrice <= 0) {
        throw new Error(`invalid start price for ${id}`);
    }
    if (absAmp <= 0) {
        throw new Error(`amp not positive for ${id}`);
    }
    let cnt = Math.max(Math.abs(amp), MAX_POSIT_CNT);
    cnt = Math.round(cnt);
    if (cnt === 0) {
        throw new Error(`invalid qty level for ${id}`);
    }
    return {
        id,
        baseAssert: `${base}USDC`,
        quoteAssert: `${quote}USDC`,
        doubled: true,
        reversed: false,
        startPrice,
        gridRate: GRID_RATE,
        gridValue: GRID_VALUE,
        status: "PENDING",
        initPosition: {
            baseQtyLvl: cnt,
            quoteQtyLvl: -cnt
        }
    };
}

// 通过 taskId 直接检查磁盘状态，标记过期就立刻移除。
async function syncWithDiskStatuses() {
    // 读取已有任务列表，便于判断过期与去重。
    let diskTasks = await loadJson(TASK_FILE);
    if (!Array.isArray(diskTasks) || autoTaskStore.size === 0) {
        return;
    }
    for (const id of Array.from(autoTaskStore)) {
        const diskTask = diskTasks.find(task => task?.id === id);
        if (diskTask?.status === "EXPIRED") {
            autoTaskStore.delete(id);
        }
    }
}


// 核心调度循环：拉取排名、生成任务并持久化到磁盘。
async function main() {
    console.log('[auto-scheduler] loop....')
    // 拉取量化批次最新快照，作为调度的决策依据。
    const latest = await loadJson(DATA_FILE);
    if (!latest || typeof latest !== "object") {
        console.error("[auto-scheduler] latest.json 不存在或格式异常");
        return;
    }
    const cycles = latest.cycles;
    if (!cycles || typeof cycles !== "object") {
        console.error("[auto-scheduler] 缺少 cycles 数据");
        return;
    }


    await syncWithDiskStatuses();

    // 计算还能投放多少自动任务，避免突破风险阈值。
    const activeAutoCount = autoTaskStore.size;
    let availableSlots = Math.max(0, MAX_TOP_COUNT - activeAutoCount);
    let limitReached = availableSlots <= 0;
    let limitLogged = false;
    if (limitReached) {
        console.log(`[auto-scheduler] 自动网格任务已达上限 (${MAX_TOP_COUNT})，等待现有任务过期`);
        limitLogged = true;
    }

    const stagedTasks = [];
    const stagedIds = new Set();

    for (const [cycleKey, cycleValue] of Object.entries(cycles)) {
        if (limitReached) {
            break;
        }
        const stage = cycleValue?.data;
        const entries = stage?.data;
        // 周期内没有有效候选则跳过。
        if (!Array.isArray(entries) || !entries.length) {
            continue;
        }
        // 评估得分，挑选当前周期最具潜力的交易对。
        const candidates = selectTopPairs(entries);
        for (const entry of candidates) {
            if (availableSlots <= 0) {
                limitReached = true;
                break;
            }
            const pricePosit = Number(entry.pricePosit);
            // 仅在价格位置贴近下沿时介入，降低追高风险。
            if (!positIsNearLower(pricePosit)) {
                continue;
            }
            const symbolParts = splitSymbol(entry.symbol);
            if (!symbolParts) {
                continue;
            }
            try {
                // 获取双边价格，用于推算初始化仓位规模。
                const {
                    basePrice,
                    quotePrice,
                    baseSymbol,
                    quoteSymbol
                } = await fetchPairPrices(symbolParts.base, symbolParts.quote);
                // 依据指标与参数生成任务实体。
                const task = buildTask({
                    base: symbolParts.base,
                    quote: symbolParts.quote,
                    lowP: entry.lowP,
                    amp: entry.amp,
                    basePrice,
                    quotePrice,
                    baseSymbol,
                    quoteSymbol
                });
                autoTaskStore.add(task.id);
                stagedTasks.push(task);
                availableSlots -= 1;
                console.log(`[auto-scheduler] 周期 ${cycleKey} 创建任务: ${task.id}`);
                if (availableSlots <= 0) {
                    limitReached = true;
                    if (!limitLogged) {
                        console.log(`[auto-scheduler] 自动网格任务已达上限 (${MAX_TOP_COUNT})，等待现有任务过期`);
                        limitLogged = true;
                    }
                }
            } catch (err) {
                console.error(`[auto-scheduler] 跳过 ${entry.symbol}: ${err.message}`);
            }
        }
    }

    if (stagedTasks.length > 0) {
        let diskSnapshot;
        try {
            diskSnapshot = await loadJson(TASK_FILE);
        } catch (err) {
            diskSnapshot = [];
        }
        const merged = Array.isArray(diskSnapshot) ? diskSnapshot : [];
        merged.push(...stagedTasks);
        await writeFile(TASK_FILE, JSON.stringify(merged, null, 4));
        console.log("[auto-scheduler] grid_tasks.json 已更新");
    }
}


// 启动自动调度器，并按固定周期重跑逻辑。
const startAutoCreator = async () => {
    console.log('[auto-scheduler] start....')
    const run = () => main().catch(console.error);
    await run();
    setInterval(run, 1000 * 60 * 7);
}


// 启动网格任务自动创建脚本
await startAutoCreator();

// export default startAutoCreator;
