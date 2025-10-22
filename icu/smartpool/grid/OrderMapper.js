import fs from 'fs/promises';
import {Low} from 'lowdb';
import {JSONFile} from 'lowdb/node';
import path from 'path';
import {fileURLToPath} from 'url';
import czClient from "./common/CzClient.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.join(__dirname, './data');
const LEGACY_DATA_FILE = path.join(DATA_DIR, 'orders.json');
const cloneDefaultData = () => ({orders: []});

class OrderMapper {
    static ORDER_FIELDS = ['taskId', 'taskBindId', 'synthPrice', 'symbol', 'orderId', 'side', 'status', 'price', 'origQty', 'updateTime',];

    constructor() {
        this.dbCache = new Map();
        this.legacyMigrated = false;
    }

    _resolveFilePath(taskId) {
        return path.join(DATA_DIR, `orders-${taskId}.json`);
    }

    async _ensureMigration() {
        if (this.legacyMigrated) {
            return;
        }

        await this._migrateLegacyData().catch(() => {
        });
        this.legacyMigrated = true;
    }

    async _migrateLegacyData() {
        let payload;
        try {
            payload = await fs.readFile(LEGACY_DATA_FILE, 'utf8');
        } catch (err) {
            if (err && err.code === 'ENOENT') {
                return;
            }
            throw err;
        }

        if (!payload) {
            return;
        }

        let parsed;
        try {
            parsed = JSON.parse(payload);
        } catch (err) {
            return;
        }

        const legacyOrders = Array.isArray(parsed)
            ? parsed
            : (Array.isArray(parsed.orders) ? parsed.orders : []);

        if (!legacyOrders.length) {
            return;
        }

        const grouped = legacyOrders.reduce((acc, order) => {
            const taskId = order?.taskId;
            if (!taskId) {
                return acc;
            }
            if (!acc.has(taskId)) {
                acc.set(taskId, []);
            }
            acc.get(taskId).push(order);
            return acc;
        }, new Map());

        for (const [taskId, orders] of grouped.entries()) {
            const filePath = this._resolveFilePath(taskId);
            let existingOrders = [];
            try {
                const content = await fs.readFile(filePath, 'utf8');
                const parsedOrders = JSON.parse(content);
                existingOrders = Array.isArray(parsedOrders)
                    ? parsedOrders
                    : (Array.isArray(parsedOrders.orders) ? parsedOrders.orders : []);
            } catch (err) {
                if (!err || err.code !== 'ENOENT') {
                    continue;
                }
            }

            const merged = [...existingOrders];
            const existingIds = new Set(existingOrders.map(item => item?.orderId));
            for (const order of orders) {
                if (order && !existingIds.has(order.orderId)) {
                    merged.push(order);
                    existingIds.add(order.orderId);
                }
            }
            await fs.writeFile(filePath, JSON.stringify({orders: merged}, null, 4));
        }
    }

    async _getDb(taskId) {
        if (!taskId || typeof taskId !== 'string') {
            throw new Error('taskId is required');
        }

        await this._ensureMigration();

        if (!this.dbCache.has(taskId)) {
            const filePath = this._resolveFilePath(taskId);
            const adapter = new JSONFile(filePath);
            const db = new Low(adapter, cloneDefaultData());
            this.dbCache.set(taskId, {db, initialized: false});
        }

        const entry = this.dbCache.get(taskId);
        if (!entry.initialized) {
            await entry.db.read();
            if (!entry.db.data) {
                entry.db.data = cloneDefaultData();
            }
            if (!Array.isArray(entry.db.data.orders)) {
                entry.db.data.orders = [];
            }
            entry.initialized = true;
        }

        return entry.db;
    }

    /**
     *     {
     *       "taskId": "SUI-SOL"
     *       "taskBindId":xxx
     *       "synthPrice":xxx
     *       "symbol": "SOLUSDT",
     *       "orderId": 155102239748,
     *       "side": "BUY",
     *       "status": "FILLED",
     *       "price": "181.6200",
     *       "origQty": "0.05",
     *       "updateTime": 1760193169211,
     *     }
     */
    async save(order) {
        if (!order || typeof order.orderId === 'undefined') {
            throw new Error('order.orderId is required');
        }

        const taskId = order.taskId;
        if (!taskId) {
            throw new Error('order.taskId is required');
        }

        const db = await this._getDb(taskId);
        const sanitizedOrder = OrderMapper.ORDER_FIELDS.reduce((result, key) => {
            if (typeof order[key] !== 'undefined') {
                result[key] = order[key];
            }
            return result;
        }, {});


        const {orders} = db.data;
        orders.push(sanitizedOrder);
        await db.write();
        return {...orders[orders.length - 1]};
    }

    async updateStatus(taskId, orderId, status) {
        if (!taskId) {
            throw new Error('taskId is required');
        }
        if (typeof orderId === 'undefined') {
            throw new Error('orderId is required');
        }
        if (typeof status === 'undefined') {
            throw new Error('status is required');
        }

        const db = await this._getDb(taskId);
        const order = db.data.orders.find(item => item.orderId === orderId);

        if (!order) {
            throw new Error(`Order ${orderId} not found`);
        }

        order.status = status;
        // 手续费获取
        let {txFee, makerFeeRate} = await czClient.getTxFee(order.symbol, order.orderId);
        order.txFee = txFee;
        order.makerFeeRate = makerFeeRate;

        await db.write();
        return {...order};
    }

    /**
     *     {
     *       "taskId": "BCHETH",
     *       "taskBindId": "7384524779370445457",
     *       "synthPrice": "0.12951529",
     *       "symbol": "BCHUSDC",
     *       "orderId": 1780590936,
     *       "side": "BUY",
     *       "status": "FILLED",
     *       "price": "521.90",
     *       "origQty": "0.050",
     *       "updateTime": 1760607905297,
     *       "txFee": 0,
     *       "makerFeeRate": "100%"
     *     }
     * @returns {Promise<number>}
     */
    async list(taskId) {
        const db = await this._getDb(taskId);
        let {orders} = db.data;
        let cnt = 0;
        orders = orders.filter(e => e.symbol === 'SOLUSDC');
        console.log(orders.length);
        let totalBidQty = 0;
        let totalBidVal = 0;
        let totalAskQty = 0;
        let totalAskVal = 0;
        for (const element of orders) {
            let order = element;
            if (order.side === 'BUY') {
                totalBidQty += Number(order.origQty);
                totalBidVal += Number(order.origQty) * Number(order.synthPrice);
            } else {
                totalAskQty += Number(order.origQty);
                totalAskVal += Number(order.origQty) * Number(order.synthPrice);
            }
        }
        console.log(totalBidVal / totalBidQty)
        console.log(totalAskVal / totalAskQty)
        await db.write();
        return cnt;
    }
}

const orderMapper = new OrderMapper();
export const saveOrder = order => orderMapper.save(order);
export const updateOrderStatus = (taskId, orderId, status) => orderMapper.updateStatus(taskId, orderId, status);
