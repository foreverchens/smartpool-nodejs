import Queue from "../common/CircularQueue.js";
import {
    readSymbol as readKlineSymbol,
    writeSymbol as writeKlineSymbol,
    readAllSymbols as readAllKlineSymbols
} from "../common/klineDb.js";

class KlineCacheManager {
    constructor(capacity) {
        this.capacity = capacity;
        this.memoryCache = new Map();
        this.initPromise = null;
    }

    async get(symbol) {
        await this.ensureInitialized();
        if (this.memoryCache.has(symbol)) {
            return this.memoryCache.get(symbol);
        }
        const queue = await this.loadFromDisk(symbol);
        if (queue) {
            this.memoryCache.set(symbol, queue);
            if (symbol === 'ETH-BTC') {
                const last = queue.peek();
                const endTime = last ? new Date(last.openT + 60 * 60 * 1000) : null;
                console.log('[CACHE][ETH-BTC] loaded from disk, end @ %s', endTime ? endTime.toISOString() : 'empty');
            }
            return queue;
        }
        const freshQueue = new Queue(this.capacity);
        this.memoryCache.set(symbol, freshQueue);
        return freshQueue;
    }

    async save(symbol) {
        await this.ensureInitialized();
        const queue = this.memoryCache.get(symbol);
        if (!queue) {
            return;
        }
        const items = queue.toArray();
        await writeKlineSymbol(symbol, items);
        if (symbol === 'ETH-BTC') {
            const last = queue.peek();
            const endTime = last ? new Date(last.openT + 60 * 60 * 1000) : null;
            console.log('[CACHE][ETH-BTC] persisted to disk, end @ %s', endTime ? endTime.toISOString() : 'empty');
        }
    }

    async loadFromDisk(symbol) {
        await this.ensureInitialized();
        try {
            const existing = await readKlineSymbol(symbol);
            if (existing !== null) {
                return this.createQueue(existing);
            }
        } catch (err) {
            console.error('Load cache failed:', symbol, err);
            return null;
        }

        return null;
    }

    async ensureInitialized() {
        if (!this.initPromise) {
            this.initPromise = this.initializeFromDb();
        }
        await this.initPromise;
    }

    async initializeFromDb() {
        try {
            const allSymbolData = await readAllKlineSymbols();
            for (const [symbol, items] of Object.entries(allSymbolData)) {
                if (!this.memoryCache.has(symbol)) {
                    this.memoryCache.set(symbol, this.createQueue(items));
                }
            }
        } catch (err) {
            console.error('初始化K线缓存失败:', err);
        }
    }

    createQueue(items) {
        const queue = new Queue(this.capacity);
        if (Array.isArray(items)) {
            for (const item of items) {
                queue.push(item);
            }
        }
        return queue;
    }
}

export default KlineCacheManager;
