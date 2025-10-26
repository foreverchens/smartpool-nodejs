import {Snowflake} from '@theinternetfolks/snowflake';
import dayjs from 'dayjs';
import callRlt from '../common/CallResult.js'
import {getTicker} from "./common/BockTickerManage.js"
import czClient from "./common/CzClient.js";
import logger from './common/logger.js';
import {formatQty} from "./common/Util.js";
import {saveOrder, updateOrderStatus} from "./OrderMapper.js";

const STATUS = {
    RUNNING: 'RUNNING',
};


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
            let msg = `[TASK ${task.id}] quote price 获取失败, 暂停启动`;
            logger.error(msg);
            return callRlt.fail(msg);
        }
        synthPrice = Number((basePrice / quotePrice).toFixed(8));
    }

    if (task.startPrice != null && synthPrice >= Number(task.startPrice)) {
        let msg = `[TASK ${task.id}] 当前价格 ${synthPrice} 未触发启动价 ${task.startPrice}`;
        console.log(msg);
        return callRlt.fail(msg);
    }
    // 启动过程
    const baseQty = formatQty(task.baseAssert, basePrice, task.gridValue / basePrice);
    let quoteQty = null;
    if (task.doubled && quotePrice) {
        quoteQty = formatQty(task.quoteAssert, quotePrice, task.gridValue / quotePrice);
    }

    const buyPrice = Number((synthPrice * (1 - task.gridRate)).toPrecision(8));
    const sellPrice = Number((synthPrice * (1 + task.gridRate)).toPrecision(8));
    const lastTradePrice = synthPrice;

    const initOrders = [];
    const initPosition = task.initPosition;
    if (initPosition && typeof initPosition === 'object') {
        const rawBaseQty = Number(initPosition.baseQty);
        const rawQuoteQty = Number(initPosition.quoteQty);

        let taskBindId = null;

        const hasBaseQty = Number.isFinite(rawBaseQty) && rawBaseQty !== 0;
        if (hasBaseQty) {
            const baseIsAsk = rawBaseQty < 0;
            const initBaseQty = formatQty(task.baseAssert, basePrice, Math.abs(rawBaseQty));
            const baseOrder = await czClient.placeOrder(task.baseAssert, baseIsAsk, initBaseQty, basePrice);
            if (baseOrder.msg) {
                let msg = `[TASK ${task.id}] 初始仓位${baseIsAsk ? '卖出' : '买入'}失败 msg:${baseOrder.msg}`;
                logger.error(msg);
                callRlt.fail(msg);
            } else {
                taskBindId = taskBindId ?? Snowflake.generate();
                baseOrder.taskId = task.id;
                baseOrder.taskBindId = taskBindId;
                baseOrder.synthPrice = synthPrice;
                initOrders.push(baseOrder);
                logger.info(`[TASK ${task.id}] 初始${baseIsAsk ? '卖出' : '买入'} ${task.baseAssert} 数量:${initBaseQty} 价格:${basePrice}`);
            }
        }

        const hasQuoteQty = Number.isFinite(rawQuoteQty) && rawQuoteQty !== 0;
        if (hasQuoteQty) {
            const quoteIsAsk = rawQuoteQty < 0;
            const initQuoteQty = formatQty(task.quoteAssert, quotePrice, Math.abs(rawQuoteQty));
            const quoteOrder = await czClient.placeOrder(task.quoteAssert, quoteIsAsk, initQuoteQty, quotePrice);
            if (quoteOrder.msg) {
                let msg = `[TASK ${task.id}] 初始仓位${quoteIsAsk ? '卖出' : '买入'}失败 msg:${quoteOrder.msg}`;
                logger.error(msg);
                callRlt.fail(msg)
            } else {
                taskBindId = taskBindId ?? Snowflake.generate();
                quoteOrder.taskId = task.id;
                quoteOrder.taskBindId = taskBindId;
                quoteOrder.synthPrice = synthPrice;
                initOrders.push(quoteOrder);
                logger.info(`[TASK ${task.id}] 初始${quoteIsAsk ? '卖出' : '买入'} ${task.quoteAssert} 数量:${initQuoteQty} 价格:${quotePrice}`);
            }
        }

        for (const order of initOrders) {
            await saveOrder(order);
        }
    }

    // 启动
    task.startPrice = synthPrice;
    task.startBaseP = basePrice;
    task.startQuoteP = quotePrice;
    task.runtime = {
        baseQty,
        quoteQty,
        buyPrice,
        sellPrice,
        lastTradePrice,
        initFilled: initOrders.length ? initOrders.map(order => ({
            symbol: order.symbol, side: order.side, qty: order.origQty, price: order.price, orderId: order.orderId
        })) : []
    };
    task.status = STATUS.RUNNING;
    console.log(`[TASK ${task.id}] 启动成功, runtime: [${buyPrice},${sellPrice}]`);

    return callRlt.ok(initOrders);
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
        curBidPrice = Number((baseBidPrice / quoteAskPrice).toPrecision(5));
        curAskPrice = Number((baseAskPrice / quoteBidPrice).toPrecision(5));
    }
    if (!Number.isFinite(curBidPrice) || curBidPrice <= 0) {
        return callRlt.ok();
    }
    console.log(`[TASK ${task.id}]  [${buyPrice} <- ${curBidPrice} | ${curAskPrice} -> ${sellPrice}]  @${dayjs().format('YYYY-MM-DD HH:mm:ss')}`);
    // console.log(`[TASK ${task.id}] 当前汇率:${curBidPrice} 买入:${buyPrice} 卖出:${sellPrice} @${dayjs().format('YYYY-MM-DD HH:mm:ss')}`);
    if (curBidPrice > buyPrice && curAskPrice < sellPrice) {
        // 仍在价格区间内
        let time = ((0.5 - Math.abs(((sellPrice + buyPrice) / 2 - curBidPrice)) / (sellPrice - buyPrice)) * 10).toFixed(0);
        return callRlt.loop(time > 1 ? time : 1);
    }
    // 进入交易价格区间
    logger.info('-------------------------')
    let [baseAssertPosit] = await czClient.getFuturesPositionRisk(baseAssert);
    let baseOrder = null;
    let quoteOrder = null;
    if (curBidPrice <= buyPrice) {
        logger.info(`[TASK ${task.id}] curP[${curBidPrice}] <= buyP[${buyPrice}] 执行买入`)
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
        logger.info(`[TASK ${task.id}] curP[${curAskPrice}] >= sellP[${sellPrice}] 执行卖出`)

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


    task.runtime.buyPrice = Number((curBidPrice * (1 - task.gridRate)).toPrecision(5));
    task.runtime.sellPrice = Number((curBidPrice * (1 + task.gridRate)).toPrecision(5));
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
        let realOrder = await czClient.getFuturesOrder(symbol, orderId).catch(e => {
            logger.error(`[ORDER ${orderId}] 订单查询异常 :${e.message}`);
        });
        if (!realOrder) {
            logger.error(`[ORDER ${orderId}] 无法获取订单详情, 暂时跳过`);
            idx++;
            continue;
        }
        const taskId = order.taskId;
        if (!taskId) {
            logger.error(`[ORDER ${orderId}] 缺少 taskId, 暂时跳过更新`);
            idx++;
            continue;
        }
        const taskBindId = order.taskBindId;
        if (realOrder.status === 'FILLED') {
            await updateOrderStatus(taskId, taskBindId, realOrder);
            logger.info(`[ORDER ${orderId}] 完全成交`);
            orderList.splice(idx, 1);
            continue;
        }
        if (['CANCELED', 'EXPIRED', 'REJECTED'].includes(realOrder.status)) {
            await updateOrderStatus(taskId, taskBindId, realOrder);
            logger.info(`[ORDER ${orderId}] 状态为 ${realOrder.status}, 移出跟踪队列`);
            orderList.splice(idx, 1);
            continue;
        }
        // 未成交 修改订单为最优价格
        let [bidP, askP] = getTicker(symbol);
        // 最新价修改挂单
        let isBuy = realOrder.side === 'BUY';
        let price = isBuy ? bidP : askP;
        if (price !== Number(realOrder.price) && price !== 0) {
            logger.info(`[ORDER ${orderId}] 价格修改 ` + realOrder.side + '  ' + realOrder.price + '-->' + price);
            let rlt = await czClient.futureModifyOrder(realOrder.symbol, realOrder.side, realOrder.orderId, realOrder.origQty, price);
            if (rlt.suc) {
                rlt.data.taskId = order.taskId;
                rlt.data.taskBindId = order.taskBindId;
                rlt.data.synthPrice = order.synthPrice;
                orderList[idx] = rlt.data;
            } else {
                logger.error(rlt.msg);
            }
        }
        idx++;
    }
}
