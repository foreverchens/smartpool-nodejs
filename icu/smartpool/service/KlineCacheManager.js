import fs from "fs";
import path from "path";
import Queue from "../common/CircularQueue.js";

class KlineCacheManager {
    constructor(capacity, baseDir = path.resolve('./data')) {
        this.capacity = capacity;
        this.memoryCache = new Map();
        this.cacheDir = path.join(baseDir, 'kline-cache');
        if (!fs.existsSync(this.cacheDir)) {
            fs.mkdirSync(this.cacheDir, {recursive: true});
        }
    }

    async get(symbol) {
        if (this.memoryCache.has(symbol)) {
            return this.memoryCache.get(symbol);
        }
        const queue = await this.loadFromDisk(symbol);
        if (queue) {
            this.memoryCache.set(symbol, queue);
            return queue;
        }
        const freshQueue = new Queue(this.capacity);
        this.memoryCache.set(symbol, freshQueue);
        return freshQueue;
    }

    async save(symbol) {
        const queue = this.memoryCache.get(symbol);
        if (!queue) {
            return;
        }
        const filePath = this.getFilePath(symbol);
        const data = JSON.stringify(queue.toArray());
        await fs.promises.writeFile(filePath, data);
    }

    async loadFromDisk(symbol) {
        const filePath = this.getFilePath(symbol);
        try {
            const content = await fs.promises.readFile(filePath, {encoding: 'utf-8'});
            const items = JSON.parse(content);
            const queue = new Queue(this.capacity);
            for (let item of items) {
                queue.push(item);
            }
            return queue;
        } catch (err) {
            if (err.code !== 'ENOENT') {
                console.error('Load cache failed:', symbol, err);
            }
            return null;
        }
    }

    getFilePath(symbol) {
        return path.join(this.cacheDir, `${symbol}.json`);
    }
}

export default KlineCacheManager;
