import {readFile, writeFile} from "fs/promises";
import path from "path";
import {fileURLToPath} from "url";
import czClient from "./common/CzClient.js";
import {formatQty} from "./common/Util.js";

const SCORE_THRESHOLD = 20000;
const MAX_TOP_COUNT = 5;
const FALLBACK_TOP_COUNT = 2;
const POSIT_MIN = 0;
const POSIT_MAX = 0.1;
const GRID_RATE = 0.005;
const GRID_VALUE = 100;

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
    const [basePrice, quotePrice] = await Promise.all([
        czClient.getFuturesPrice(baseSymbol),
        czClient.getFuturesPrice(quoteSymbol)
    ]);
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
    const baseQty = formatQty(base, basePrice, GRID_VALUE / basePrice) * Math.abs(amp);
    const quoteQty = formatQty(quote, quotePrice, GRID_VALUE / quotePrice) * Math.abs(amp) * -1;
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
            baseQty,
            quoteQty
        }
    };
}

function upsertTask(existingTasks, newTask) {
    const next = [...existingTasks];
    const index = next.findIndex(task => task && task.id === newTask.id);
    if (index < 0) {
        next.push(newTask);
    }
    return next;
}

async function main() {
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

    for (const [cycleKey, cycleValue] of Object.entries(cycles)) {
        const stage = cycleValue?.data;
        const entries = stage?.data;
        if (!Array.isArray(entries) || !entries.length) {
            continue;
        }
        const candidates = selectTopPairs(entries);
        for (const entry of candidates) {
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
                console.log(task)
                tasks = upsertTask(tasks, task);
                console.log(`[auto-scheduler] 周期 ${cycleKey} 创建/更新任务: ${task.id}`);
            } catch (err) {
                console.error(`[auto-scheduler] 跳过 ${entry.symbol}: ${err.message}`);
            }
        }
    }

    await writeFile(TASK_FILE, JSON.stringify(tasks, null, 4));
    console.log("[auto-scheduler] grid_tasks.json 已更新");
}

main().catch(err => {
    console.error("[auto-scheduler] 执行失败:", err);
    process.exitCode = 1;
});
