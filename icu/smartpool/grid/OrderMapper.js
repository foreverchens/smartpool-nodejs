import {Low} from 'lowdb';
import {JSONFile} from 'lowdb/node';
import path from 'path';
import {fileURLToPath} from 'url';
import czClient from "./common/CzClient.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_FILE = path.join(__dirname, './data/orders.json');
const cloneDefaultData = () => ({orders: []});

const adapter = new JSONFile(DATA_FILE);
const db = new Low(adapter, cloneDefaultData());

class OrderMapper {
    static ORDER_FIELDS = ['taskId', 'taskBindId', 'synthPrice', 'symbol', 'orderId', 'side', 'status', 'price', 'origQty', 'updateTime',];

    constructor(database) {
        this.db = database;
        this.initialized = false;
    }

    async _init() {
        if (this.initialized) {
            return;
        }

        await this.db.read();
        if (!this.db.data) {
            this.db.data = cloneDefaultData();
        }
        this.initialized = true;
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

        await this._init();
        const sanitizedOrder = OrderMapper.ORDER_FIELDS.reduce((result, key) => {
            if (typeof order[key] !== 'undefined') {
                result[key] = order[key];
            }
            return result;
        }, {});


        const {orders} = this.db.data;
        orders.push(sanitizedOrder);
        await this.db.write();
        return {...orders[orders.length - 1]};
    }

    async updateStatus(orderId, status) {
        if (typeof orderId === 'undefined') {
            throw new Error('orderId is required');
        }
        if (typeof status === 'undefined') {
            throw new Error('status is required');
        }

        await this._init();
        const order = this.db.data.orders.find(item => item.orderId === orderId);

        if (!order) {
            throw new Error(`Order ${orderId} not found`);
        }

        order.status = status;
        // 手续费获取
        let {txFee, makerFeeRate} = await czClient.getTxFee(order.symbol, order.orderId);
        order.txFee = txFee;
        order.makerFeeRate = makerFeeRate;

        await this.db.write();
        return {...order};
    }

    async list() {
        await this._init();
        const {orders} = this.db.data;
        let cnt = 0;
        for (const element of orders) {
            let order = element;
            if (order.makerFeeRate === '0%' && order.txFee === 0) {
                // 手续费获取
                let {txFee, makerFeeRate} = await czClient.getTxFee(order.symbol, order.orderId);
                order.txFee = txFee;
                order.makerFeeRate = makerFeeRate;
                console.log(order.orderId);
                console.log(txFee);
                console.log(makerFeeRate);
                cnt++;
            }
        }
        await this.db.write();
        return cnt;
    }
}

const orderMapper = new OrderMapper(db);
// orderMapper.list().then(e=> console.log(e));
export const saveOrder = order => orderMapper.save(order);
export const updateOrderStatus = (orderId, status) => orderMapper.updateStatus(orderId, status);
