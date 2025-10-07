import path from 'path';
import {fileURLToPath} from 'url';
import {mkdir} from 'fs/promises';
import {Low} from 'lowdb';
import {JSONFile} from 'lowdb/node';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.resolve(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'kline-cache.json');

const adapter = new JSONFile(DB_FILE);
const defaultData = {symbols: {}};
const db = new Low(adapter, defaultData);

let initPromise = null;

// Lazy initialization, ensures the JSON store is ready once per process.
async function ensureDb() {
    if (!initPromise) {
        initPromise = (async () => {
            await mkdir(DATA_DIR, {recursive: true});
            await db.read();
            if (!db.data) {
                db.data = {symbols: {}};
            } else if (!db.data.symbols || typeof db.data.symbols !== 'object') {
                db.data.symbols = {};
            }
        })();
    }
    await initPromise;
}

// Returns a deep copy so callers cannot mutate db internals.
function cloneSymbolsMap() {
    return JSON.parse(JSON.stringify(db.data.symbols));
}

// Fetch cached bars for a given symbol; null 表示完全没有记录。
export async function readSymbol(symbol) {
    await ensureDb();
    return db.data.symbols[symbol] ?? null;
}

// 覆盖写入指定 symbol 的缓存数组，并立即持久化。
export async function writeSymbol(symbol, items) {
    await ensureDb();
    db.data.symbols[symbol] = items ?? [];
    await db.write();
}

// 删除单个 symbol 的缓存（若存在），保持存储文件同步。
export async function deleteSymbol(symbol) {
    await ensureDb();
    if (Object.prototype.hasOwnProperty.call(db.data.symbols, symbol)) {
        delete db.data.symbols[symbol];
        await db.write();
    }
}

// 列出当前已有缓存的所有 symbol。
export async function listSymbols() {
    await ensureDb();
    return Object.keys(db.data.symbols);
}

// 一次性获取全量缓存的浅拷贝供批量初始化使用。
export async function readAllSymbols() {
    await ensureDb();
    return cloneSymbolsMap();
}

export {DB_FILE};
