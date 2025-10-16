import {Snowflake} from '@theinternetfolks/snowflake';
import dayjs from 'dayjs';
import callRlt from '../common/CallResult.js'
import {getTicker} from "./common/BockTickerManage.js"
import czClient from "./common/CzClient.js";
import logger from './common/logger.js';
import {saveOrder, updateOrderStatus} from "./OrderMapper.js";

const STATUS = {
    RUNNING: 'RUNNING',
};

/**
 * 基于价格修正数量精度
 * @param price
 * @param qty
 * @returns {number|string}
 */
function formatQtyByPrice(price, qty) {
    if (price < 1) {
        return Math.floor(qty)
    } else if (price > 10000) {
        return qty.toFixed(3)
    } else if (price > 100) {
        return qty.toFixed(2)
    } else {
        return qty.toFixed(1);
    }
}

/**
 * 尝试启动网格任务
 */
export async function tryStart(task) {
    const basePrice = await czClient.getFuturesPrice(task.baseAssert);
    let synthPrice = basePrice;
    let quotePrice = null;

    if (task.doubled) {
        quotePrice = await czClient.getFuturesPrice(task.quoteAssert);
        if (!quotePrice) {
            logger.error(`[TASK ${task.id}] quote price 获取失败, 暂停启动`);
            return false;
        }
        synthPrice = Number((basePrice / quotePrice).toFixed(8));
    }

    if (task.startPrice != null && synthPrice >= Number(task.startPrice)) {
        console.log(`[TASK ${task.id}] 当前价格 ${synthPrice} 未触发启动价 ${task.startPrice}`);
        return false;
    }
    // 启动
    task.startPrice = synthPrice;
    task.startBaseP = basePrice;
    task.startQuoteP = quotePrice;
    const baseQty = formatQtyByPrice(basePrice, task.gridValue / basePrice);
    let quoteQty = null;
    if (task.doubled && quotePrice) {
        quoteQty = formatQtyByPrice(quotePrice, task.gridValue / quotePrice);
    }

    const buyPrice = Number((synthPrice * (1 - task.gridRate)).toPrecision(8));
    const sellPrice = Number((synthPrice * (1 + task.gridRate)).toPrecision(8));
    const lastTradePrice = synthPrice;

    task.runtime = {
        baseQty, quoteQty, buyPrice, sellPrice, lastTradePrice
    };
    task.status = STATUS.RUNNING;
    console.log(`[TASK ${task.id}] 启动成功, runtime: ${JSON.stringify(task.runtime)}`);
    return true;
}

/**
 * 处理网格任务
 * @param task
 */
export async function dealTask(task) {
    if (!task.runtime) {
        logger.error(`[TASK ${task.id}] runtime 未初始化, 跳过处理`);
        return callRlt.ok();
    }

    const baseAssert = task.baseAssert;
    const quoteAssert = task.quoteAssert;
    const {
        baseQty, quoteQty, buyPrice, sellPrice,
    } = task.runtime;

    // 获取最新汇率
    let [baseBidPrice, baseAskPrice] = getTicker(baseAssert);
    let [quoteBidPrice, quoteAskPrice] = getTicker(quoteAssert);

    let curBidPrice = baseBidPrice;
    let curAskPrice = baseAskPrice;
    if (task.doubled) {
        curBidPrice = (baseBidPrice / quoteAskPrice).toPrecision(8);
        curAskPrice = (baseAskPrice / quoteBidPrice).toPrecision(8);
    }

    console.log(`[TASK ${task.id}] 当前汇率:${curBidPrice} 买入:${buyPrice} 卖出:${sellPrice} @${dayjs().format('YYYY-MM-DD HH:mm:ss')}`);
    if (curBidPrice > buyPrice && curAskPrice < sellPrice) {
        // 仍在价格区间内
        return callRlt.ok();
    }
    // 进入交易价格

    let [baseAssertPosit] = await czClient.getFuturesPositionRisk(baseAssert);
    let baseOrder = null;
    let quoteOrder = null;
    if (curBidPrice < buyPrice) {
        logger.info(`[TASK ${task.id}] curP[${curBidPrice}] < buyP[${buyPrice}] 执行买入`)
        // 汇率降低、
        // 买入gridValue等值base资产、卖出等值quote资产
        if (!task.reversed) {
            // 默认不支持订单反向、以base资产为准
            // 不支持反向、检查剩余仓位是否满足开单要求
            // 当前执行base资产买入、若当前持有空单、检查是否满足此次买入平仓
            if (baseAssertPosit?.positionAmt && Number(baseAssertPosit.positionAmt) < 0 && Number(baseAssertPosit.positionAmt) + baseQty > 0) {
                let msg = `[TASK ${task.id}] 仓位不足, 待买入:${baseQty}, 当前仓位:${baseAssertPosit.positionAmt}`;
                logger.error(msg);
                return callRlt.fail(msg);
            }
        }
        // 先下远单在修改、防止maker变taker
        baseOrder = await czClient.placeOrder(baseAssert, 0, baseQty, baseBidPrice);
        // baseOrder = await czClient.futureBuy(baseAssert, baseQty, baseOrderBook.bids[9].price);
        // baseOrder = await czClient.futureModifyOrder(baseAssert, baseOrder.side, baseOrder.orderId, baseQty, baseOrderBook.bids[0].price);
        if (baseOrder.msg) {
            // 下单失败
            let msg = `[TASK ${task.id}] 买入失败 msg:${baseOrder.msg}`;
            logger.error(msg)
            return callRlt.fail(msg);
        }
        const taskBindId = Snowflake.generate();

        baseOrder.taskId = task.id;
        baseOrder.taskBindId = taskBindId;
        baseOrder.synthPrice = curBidPrice;
        // 持久化
        await saveOrder(baseOrder);
        logger.info(`[TASK ${task.id}] ${baseAssert} 触发买入 买入汇率:${curBidPrice} 数量:${baseQty} , 订单Id:${baseOrder.orderId}`);
        if (task.doubled) {
            quoteOrder = await czClient.placeOrder(quoteAssert, 1, quoteQty, quoteAskPrice);
            if (quoteOrder.msg) {
                // 下单失败
                let msg = `[TASK ${task.id}] 卖出失败 msg:${quoteOrder.msg}`;
                logger.error(msg)
                return callRlt.fail(msg);
            }
            // quoteOrder = await czClient.futureSell(quoteAssert, quoteQty, quoteOrderBook.asks[9].price);
            // quoteOrder = await czClient.futureModifyOrder(quoteAssert, quoteOrder.side, quoteOrder.orderId, quoteQty, quoteOrderBook.asks[0].price);
            quoteOrder.taskId = task.id;
            quoteOrder.taskBindId = taskBindId;
            quoteOrder.synthPrice = curBidPrice;
            // 持久化
            await saveOrder(quoteOrder);
            logger.info(`[TASK ${task.id}] ${quoteAssert} 触发卖出 卖出汇率:${curBidPrice} 数量:${quoteQty} , 订单:${quoteOrder.orderId}`);
        }
    } else {
        logger.info(`[TASK ${task.id}] curP[${curBidPrice}] > sellP[${sellPrice}] 执行卖出`)

        // 汇率上涨
        // 卖出gridValue等值base资产、买入等值quote资产

        if (!task.reversed) {
            // 默认不支持订单反向、以base资产为准
            // 不支持反向、检查剩余仓位是否满足开单要求
            // 当前为卖出场合、持有多单时需检查、买前检查多单仓位、仓位不足则取消交易
            if (baseAssertPosit?.positionAmt && Number(baseAssertPosit.positionAmt) > 0 && Number(baseAssertPosit.positionAmt) - baseQty < 0) {
                let msg = `[TASK ${task.id}] 仓位不足, 待卖出:${baseQty}, 当前仓位:${baseAssertPosit.positionAmt}`;
                logger.error(msg);
                return callRlt.fail(msg);
            }
        }
        baseOrder = await czClient.placeOrder(baseAssert, 1, baseQty, baseAskPrice);
        if (baseOrder.msg) {
            // 下单失败
            let msg = `[TASK ${task.id}] 卖出失败 msg:${baseOrder.msg}`;
            logger.error(msg)
            return callRlt.fail(msg);
        }
        // baseOrder = await czClient.futureSell(baseAssert, baseQty, baseOrderBook.asks[9].price);
        // baseOrder = await czClient.futureModifyOrder(baseAssert, baseOrder.side, baseOrder.orderId, baseQty, baseOrderBook.asks[0].price);
        const taskBindId = Snowflake.generate();
        baseOrder.taskId = task.id;
        baseOrder.taskBindId = taskBindId;
        baseOrder.synthPrice = curAskPrice;
        // 持久化
        await saveOrder(baseOrder);
        logger.info(`[TASK ${task.id}] ${baseAssert} 触发卖出 卖出汇率:${curAskPrice} 数量:${baseQty} , 订单:${baseOrder.orderId}`);
        if (task.doubled) {
            quoteOrder = await czClient.placeOrder(quoteAssert, 0, quoteQty, quoteBidPrice);
            if (quoteOrder.msg) {
                // 下单失败
                let msg = `[TASK ${task.id}] 买入失败 msg:${quoteOrder.msg}`;
                logger.error(msg)
                return callRlt.fail(msg);
            }
            // quoteOrder = await czClient.futureBuy(quoteAssert, quoteQty, quoteOrderBook.bids[9].price);
            // quoteOrder = await czClient.futureModifyOrder(quoteAssert, quoteOrder.side, quoteOrder.orderId, quoteQty, quoteOrderBook.bids[0].price);
            quoteOrder.taskId = task.id;
            quoteOrder.taskBindId = taskBindId;
            quoteOrder.synthPrice = curAskPrice;
            // 持久化
            await saveOrder(quoteOrder);
            logger.info(`[TASK ${task.id}] ${quoteAssert} 触发买入 买入汇率:${curAskPrice} 数量 ${quoteQty} , 订单:${quoteOrder.orderId}`);
        }
    }


    task.runtime.buyPrice = Number((curBidPrice * (1 - task.gridRate)).toPrecision(8));
    task.runtime.sellPrice = Number((curBidPrice * (1 + task.gridRate)).toPrecision(8));
    task.runtime.lastTradePrice = curBidPrice;

    const orders = [];
    if (baseOrder?.orderId) {
        orders.push(baseOrder);
    }
    if (quoteOrder?.orderId) {
        orders.push(quoteOrder);
    }

    return callRlt.ok(orders);
}

/**
 * 处理订单列表
 * @param orderList
 */
export async function dealOrder(orderList) {
    let idx = 0;
    while (idx < orderList.length) {
        let order = orderList[idx];
        let orderId = order.orderId;
        let symbol = order.symbol;
        let realOrder = await czClient.getFuturesOrder(symbol, orderId);
        if (!realOrder) {
            logger.error(`[ORDER ${orderId}] 无法获取订单详情, 暂时跳过`);
            idx++;
            continue;
        }
        if (realOrder.status === 'FILLED') {
            // 完全成交
            await updateOrderStatus(orderId, 'FILLED');
            logger.info(`[ORDER ${orderId}] 完全成交`);
            orderList.splice(idx, 1);
            continue;
        }
        if (['CANCELED', 'EXPIRED', 'REJECTED'].includes(realOrder.status)) {
            await updateOrderStatus(orderId, realOrder.status);
            logger.info(`[ORDER ${orderId}] 状态为 ${realOrder.status}, 移出跟踪队列`);
            orderList.splice(idx, 1);
            continue;
        }
        idx++;
        // 未成交 修改订单为最优价格
        let [bidP, askP] = getTicker(symbol);
        // 最新价修改挂单
        let isBuy = realOrder.side === 'BUY';
        let price = isBuy ? bidP : askP;
        if (price !== Number(realOrder.price)) {
            logger.info(`[ORDER ${orderId}] 价格修改 ` + realOrder.side + '  ' + realOrder.price + '-->' + price);
            let rlt = await czClient.futureModifyOrder(realOrder.symbol, realOrder.side, realOrder.orderId, realOrder.origQty, price);
            if (rlt.suc) {
                order = rlt.data;
            } else {
                logger.error(rlt.msg);
            }
        }
    }
}
