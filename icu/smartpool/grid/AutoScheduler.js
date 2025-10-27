import {readFile, writeFile} from "fs/promises";
import path from "path";
import {fileURLToPath} from "url";
import czClient from "./common/CzClient.js";
import {formatQty} from "./common/Util.js";

const SCORE_THRESHOLD = 20000;
const MAX_TOP_COUNT = 2;
const FALLBACK_TOP_COUNT = 1;
const POSIT_MIN = 0;
const POSIT_MAX = 0.1;
const GRID_RATE = 0.005;
const GRID_VALUE = 20;
const MAX_POS_CNT = 5;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "..");
const DATA_FILE = path.join(ROOT_DIR, "data", "latest.json");
const TASK_FILE = path.join(__dirname, "data", "grid_tasks.json");

async function loadJson(filePath, defaultValue) {
    try {
        const raw = await readFile(filePath, "utf8");
        return JSON.parse(raw);
    } catch (err) {
        if (err.code === "ENOENT") {
            return defaultValue;
        }
        throw err;
    }
}

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

function positIsNearLower(posit) {
    return typeof posit === "number" && posit > POSIT_MIN && posit < POSIT_MAX;
}

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

function buildTask({base, quote, lowP, amp, basePrice, quotePrice}) {
    const id = `${base}${quote}-auto`;
    const absAmp = Math.abs(Number(amp) || 0);
    const startPrice = Number(lowP);
    if (!Number.isFinite(startPrice) || startPrice <= 0) {
        throw new Error(`invalid start price for ${id}`);
    }
    if (absAmp <= 0) {
        throw new Error(`amp not positive for ${id}`);
    }
    let cnt = Math.max(Math.abs(amp), MAX_POS_CNT);
    const baseQty = formatQty(base, basePrice, GRID_VALUE / basePrice) * cnt;
    const quoteQty = formatQty(quote, quotePrice, GRID_VALUE / quotePrice) * -cnt;
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
            baseQty, quoteQty
        }
    };
}

function isAutoTask(task) {
    return Boolean(task?.id) && typeof task.id === "string" && task.id.endsWith("-auto");
}

function countActiveAutoTasks(tasks = []) {
    return tasks.filter(task => isAutoTask(task) && (task.status ?? "PENDING") !== "EXPIRED").length;
}

function upsertTask(existingTasks, newTask) {
    const next = [...existingTasks];
    const index = next.findIndex(task => task && task.id === newTask.id);
    if (index < 0) {
        next.push(newTask);
        return {tasks: next, inserted: true};
    }
    const current = next[index];
    if ((current?.status ?? "PENDING") === "EXPIRED") {
        next[index] = newTask;
        return {tasks: next, inserted: true};
    }
    return {tasks: next, inserted: false};
}

async function main() {
    console.log('[Auto Creator] loop....')
    const latest = await loadJson(DATA_FILE, null);
    if (!latest || typeof latest !== "object") {
        console.error("[auto-scheduler] latest.json 不存在或格式异常");
        return;
    }
    const cycles = latest.cycles;
    if (!cycles || typeof cycles !== "object") {
        console.error("[auto-scheduler] 缺少 cycles 数据");
        return;
    }

    let tasks = await loadJson(TASK_FILE, []);
    if (!Array.isArray(tasks)) {
        console.warn("[auto-scheduler] grid_tasks.json 非数组，将重新初始化");
        tasks = [];
    }

    const activeAutoCount = countActiveAutoTasks(tasks);
    let availableSlots = Math.max(0, MAX_TOP_COUNT - activeAutoCount);
    let limitReached = availableSlots <= 0;
    let limitLogged = false;
    if (limitReached) {
        console.log(`[auto-scheduler] 自动网格任务已达上限 (${MAX_TOP_COUNT})，等待现有任务过期`);
        limitLogged = true;
    }

    for (const [cycleKey, cycleValue] of Object.entries(cycles)) {
        if (limitReached) {
            break;
        }
        const stage = cycleValue?.data;
        const entries = stage?.data;
        if (!Array.isArray(entries) || !entries.length) {
            continue;
        }
        const candidates = selectTopPairs(entries);
        for (const entry of candidates) {
            if (availableSlots <= 0) {
                limitReached = true;
                break;
            }
            const pricePosit = Number(entry.pricePosit);
            if (!positIsNearLower(pricePosit)) {
                continue;
            }
            const symbolParts = splitSymbol(entry.symbol);
            if (!symbolParts) {
                continue;
            }
            try {
                const {basePrice, quotePrice} = await fetchPairPrices(symbolParts.base, symbolParts.quote);
                const task = buildTask({
                    base: symbolParts.base,
                    quote: symbolParts.quote,
                    lowP: entry.lowP,
                    amp: entry.amp,
                    basePrice,
                    quotePrice
                });
                const {tasks: nextTasks, inserted} = upsertTask(tasks, task);
                tasks = nextTasks;
                if (inserted) {
                    availableSlots -= 1;
                    console.log(`[auto-scheduler] 周期 ${cycleKey} 创建/更新任务: ${task.id}`);
                    if (availableSlots <= 0) {
                        limitReached = true;
                        if (!limitLogged) {
                            console.log(`[auto-scheduler] 自动网格任务已达上限 (${MAX_TOP_COUNT})，等待现有任务过期`);
                            limitLogged = true;
                        }
                    }
                }
            } catch (err) {
                console.error(`[auto-scheduler] 跳过 ${entry.symbol}: ${err.message}`);
            }
        }
    }

    await writeFile(TASK_FILE, JSON.stringify(tasks, null, 4));
    console.log("[auto-scheduler] grid_tasks.json 已更新");
}


const startAutoCreator = async () => {
    console.log('[Auto Creator] start....')
    const run = () => main().catch(console.error);
    await run();
    setInterval(run, 1000 * 60 * 7);
}
export default startAutoCreator;

