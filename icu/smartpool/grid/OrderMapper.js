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
    async list() {
        await this._init();
        let {orders} = this.db.data;
        let cnt = 0;
        orders = orders.filter(e => e.symbol === 'BCHUSDC');
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
        await this.db.write();
        return cnt;
    }
}

const orderMapper = new OrderMapper(db);
// orderMapper.list().then(e => console.log(e));
export const saveOrder = order => orderMapper.save(order);
export const updateOrderStatus = (orderId, status) => orderMapper.updateStatus(orderId, status);
