import path from 'path';
import {fileURLToPath} from 'url';
import {mkdir, readdir, readFile, unlink, writeFile} from 'fs/promises';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CACHE_DIR = path.resolve(__dirname, '..', 'data', 'kline-cache');
const FILE_SUFFIX = '.json';

let readyPromise = null;

function ensureSymbolSafe(symbol) {
    if (typeof symbol !== 'string' || symbol.length === 0) {
        throw new Error('symbol must be a non-empty string');
    }
    if (symbol.includes('/') || symbol.includes('\\') || symbol.includes('..')) {
        throw new Error(`invalid symbol name: ${symbol}`);
    }
    return symbol;
}

function buildFilePath(symbol) {
    return path.join(CACHE_DIR, `${symbol}${FILE_SUFFIX}`);
}

async function ensureReady() {
    if (!readyPromise) {
        readyPromise = mkdir(CACHE_DIR, {recursive: true});
    }
    await readyPromise;
}

async function loadSymbolFile(symbol) {
    const filePath = buildFilePath(symbol);
    try {
        const raw = await readFile(filePath, 'utf8');
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch (err) {
        if (err.code === 'ENOENT') {
            return null;
        }
        console.warn('Failed to load kline cache file:', filePath, err);
        return [];
    }
}

async function persistSymbolFile(symbol, items) {
    const filePath = buildFilePath(symbol);
    const payload = `${JSON.stringify(Array.isArray(items) ? items : [], null, 2)}\n`;
    await writeFile(filePath, payload, 'utf8');
}

export async function readSymbol(symbol) {
    await ensureReady();
    ensureSymbolSafe(symbol);
    return await loadSymbolFile(symbol);
}

export async function writeSymbol(symbol, items) {
    await ensureReady();
    ensureSymbolSafe(symbol);
    await persistSymbolFile(symbol, items ?? []);
}

export async function deleteSymbol(symbol) {
    await ensureReady();
    ensureSymbolSafe(symbol);
    try {
        await unlink(buildFilePath(symbol));
    } catch (err) {
        if (err.code !== 'ENOENT') {
            throw err;
        }
    }
}

export async function listSymbols() {
    await ensureReady();
    let entries = [];
    try {
        entries = await readdir(CACHE_DIR);
    } catch (err) {
        if (err.code !== 'ENOENT') {
            console.warn('Failed to read cache directory:', err);
        }
        return [];
    }

    return entries
        .filter((file) => file.endsWith(FILE_SUFFIX))
        .map((file) => file.slice(0, file.length - FILE_SUFFIX.length));
}

export async function readAllSymbols() {
    await ensureReady();
    const symbols = await listSymbols();
    const result = {};
    for (const symbol of symbols) {
        const items = await loadSymbolFile(symbol);
        if (items !== null) {
            result[symbol] = items;
        }
    }
    return result;
}
