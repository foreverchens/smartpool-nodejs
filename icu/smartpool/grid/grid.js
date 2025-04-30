const czClient = require('./CzClient');
const fs = require('fs')

let baseAssert = 'BTCUSDC'
let quotaAssert = 'USDT'
// 启动价格和方向
let startPrice;
// 默认上涨
let sideUp;


// 追加终端参数
const [bs, qs, sd, sp] = process.argv.slice(2);
if (bs) {
    baseAssert = bs;
    console.log('baseAssert终端参数:%s', baseAssert)
}
if (qs) {
    quotaAssert = qs;
    console.log('quotaAssert终端参数:%s', quotaAssert)
}
if (sd && sp) {
    sideUp = sd !== 'DOWN'
    console.log('是否看多网格:%s', sideUp)
    startPrice = sp;
    console.log('startPrice终端参数:%s', startPrice)
}

// 等比网格、单网格比例
let gridRate = 0.005;
// 单网格交易仓位等值USDT
let gridValue = 200;
let curPrice, buyPrice, sellPrice;
// 兼容单币网格
const simpleGrid = quotaAssert === 'USDT';
// 是否支持反向、仅针对单币网格场景、默认不支持反向
const reversed = false

// 加载配置
updateConfig()
console.table({
    'baseAssert': baseAssert,
    'quotaAssert': quotaAssert,
    'startPrice': startPrice,
    'sideUp': sideUp,
    'gridRate': gridRate,
    'gridValue': gridValue,
    'simpleGrid': simpleGrid,
    'startTime': new Date().toLocaleString()
})

function updateConfig() {
    try {
        const content = fs.readFileSync('./common/' + baseAssert + '_' + quotaAssert + '_config.json', 'utf-8');
        let config = JSON.parse(content);
        // 更新参数
        gridValue = config.gridValue;
        if (gridRate !== config.gridRate) {
            // 更新单格利率、和下一交易汇率
            console.log('利率更新: %s -> %s', gridRate, config.gridRate)
            gridRate = config.gridRate;
        }
    } catch (err) {
        console.error('config.json 404')
    }
}

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

async function getCurPrice() {
    return simpleGrid ? await czClient.getFuturesPrice(baseAssert) : await czClient.getSynPrice(baseAssert, quotaAssert);
}

/**
 * 检查订单成交否
 */
async function orderCallback(baseOrderId, quotaOrderId) {
    console.log('[%s,%s]', baseOrderId, quotaOrderId)
    if (!baseOrderId && !quotaOrderId) {
        return
    }
    let baseOrder = {}, quotaOrder = {};
    try {
        if (baseOrderId) {
            baseOrder = await czClient.getFuturesOrder(baseAssert, baseOrderId);
            console.log('baseOrder:\n%s', baseOrder)
        }
        if (quotaOrderId) {
            quotaOrder = await czClient.getFuturesOrder(quotaAssert, quotaOrderId);
            console.log('quotaOrder:\n%s', quotaOrder)
        }
        if ((simpleGrid && baseOrderId && baseOrder.status !== 'NEW') || (baseOrderId && quotaOrderId && baseOrder.status !== 'NEW' && quotaOrder.status !== 'NEW')) {
            console.log('订单Id[%s,%s]完全成交', baseOrderId, quotaOrderId)
            // 写入文件
            let rlt = [baseOrder.symbol, baseOrder.side, curPrice, baseOrder.price, baseOrder.origQty, baseOrder.orderId, Date.now()].join(',') + '\n';
            fs.appendFileSync('./common/' + baseAssert + '_' + quotaAssert + '_database.txt', rlt);
            if (!simpleGrid) {
                rlt = [quotaOrder.symbol, quotaOrder.side, curPrice, quotaOrder.price, quotaOrder.origQty, quotaOrder.orderId, Date.now()].join(',') + '\n';
                fs.appendFileSync('./common/' + baseAssert + '_' + quotaAssert + '_database.txt', rlt);
            }
            return
        }
        if (baseOrder && baseOrder.status === 'NEW') {
            // 撤单
            // 存在撤单失败情况、原因:订单刚刚成交
            await czClient.futuresCancel(baseAssert, baseOrderId);
            let sideBuy = baseOrder.side === 'BUY'
            // 重新获取订单簿
            let baseOrderBook = await czClient.getFuturesBookTicker(baseAssert);
            let baseP = sideBuy ? baseOrderBook.bidPrice : baseOrderBook.askPrice;
            // 最新价重新挂单
            baseOrder = sideBuy ? await czClient.futureBuy(baseAssert, baseOrder.origQty, baseP) : await czClient.futureSell(baseAssert, baseOrder.origQty, baseP)
            console.log('%s-%s重新挂单[%s-->%s]', baseAssert, baseP, baseOrderId, baseOrder.orderId)
        }
        if (!simpleGrid && quotaOrder && quotaOrder.status === 'NEW') {
            // 撤单
            await czClient.futuresCancel(quotaAssert, quotaOrderId);
            let sideBuy = quotaOrder.side === 'BUY'
            // 重新获取订单簿
            let quotaOrderBook = await czClient.getFuturesBookTicker(quotaAssert);
            let quotaP = sideBuy ? quotaOrderBook.bidPrice : quotaOrderBook.askPrice;
            // 最新价重新挂单
            quotaOrder = sideBuy ? await czClient.futureBuy(quotaAssert, quotaOrder.origQty, quotaP) : await czClient.futureSell(quotaAssert, quotaOrder.origQty, quotaP)
            console.log('%s-%s重新挂单[%s-->%s]', quotaAssert, quotaP, quotaOrderId, quotaOrder.orderId)
        }
    } catch (error) {
        console.error(error)
    }
    setTimeout(() => {
        orderCallback(baseOrder.orderId, quotaOrder.orderId)
    }, 1000 * 2)
}

async function gridLoop() {
    try {
        updateConfig();
        // 获取最新汇率
        curPrice = await getCurPrice();
        console.log('当前汇率:%s 下一买入汇率:%s 下一卖出汇率:%s', curPrice, buyPrice, sellPrice)
        if (curPrice < buyPrice || curPrice > sellPrice) {
            // 进入交易价格
            let baseOrderBook, quotaOrderBook;
            let baseP, quotaP;
            let baseQty, quotaQty;

            baseOrderBook = await czClient.getFuturesBookTicker(baseAssert);
            baseP = baseOrderBook.bidPrice;
            baseQty = formatQtyByPrice(baseP, gridValue / baseP)
            console.log('baseP:%s,baseQty:%s', baseP, baseQty)

            if (!simpleGrid) {
                quotaOrderBook = await czClient.getFuturesBookTicker(quotaAssert);
                quotaP = quotaOrderBook.bidPrice;
                quotaQty = formatQtyByPrice(quotaP, gridValue / quotaP)
                console.log('quotaP:%s,quotaQty:%s', quotaP, quotaQty)
            }

            let [baseAssertPosit] = await czClient.getFuturesPositionRisk(baseAssert);
            let baseOrder = {}, quotaOrder = {};
            if (curPrice < buyPrice) {
                // 汇率降低、
                // 买入gridValue等值base资产、卖出等值quota资产
                if (simpleGrid && !reversed) {
                    // 单币网格、不支持反向、检查剩余仓位是否满足开单要求
                    // 当前为买入场合、持有空单时需检查、买前检查空单仓位、仓位不足则取消交易
                    if (baseAssertPosit && baseAssertPosit.positionAmt && Number(baseAssertPosit.positionAmt) < 0 && Number(baseAssertPosit.positionAmt) + baseQty > 0) {
                        console.log('仓位不足、待买入仓位:[%s],目前持有仓位:[%s]', baseQty, baseAssertPosit.positionAmt)
                        return
                    }
                }
                baseOrder = await czClient.futureBuy(baseAssert, baseQty, baseP);
                console.log('当前汇率%s低于买入汇率价%s、执行买入%s刀%s、订单时间：%s\n买单:%s', curPrice, buyPrice, gridValue, baseAssert, Date.now(), baseOrder)
                if (!simpleGrid) {
                    quotaOrder = await czClient.futureSell(quotaAssert, quotaQty, quotaOrderBook.askPrice)
                    console.log('当前汇率%s低于买入汇率价%s、执行卖出%s刀%s、订单时间：%s\n卖单:%s', curPrice, buyPrice, gridValue, quotaAssert, Date.now(), quotaOrder)
                }
            } else {
                // 汇率上涨
                // 卖出gridValue等值base资产、买入等值quota资产
                if (simpleGrid && !reversed) {
                    // 单币网格、不支持反向、检查剩余仓位是否满足开单要求
                    // 当前为卖出场合、持有多单时需检查、买前检查多单仓位、仓位不足则取消交易
                    if (baseAssertPosit && baseAssertPosit.positionAmt && Number(baseAssertPosit.positionAmt) > 0 && Number(baseAssertPosit.positionAmt) - baseQty < 0) {
                        console.log('仓位不足、待卖出仓位:[%s],目前持有仓位:[%s]', baseQty, baseAssertPosit.positionAmt)
                        return
                    }
                }
                baseOrder = await czClient.futureSell(baseAssert, baseQty, baseOrderBook.askPrice);
                console.log('当前汇率%s高于卖出汇率价%s、执行卖出%s刀 %s、订单时间：%s\n卖单:%s', curPrice, sellPrice, gridValue, baseAssert, Date.now(), baseOrder)
                if (!simpleGrid) {
                    quotaOrder = await czClient.futureBuy(quotaAssert, quotaQty, quotaP);
                    console.log('当前汇率%s高于卖出汇率价%s、执行买入%s刀%s、订单时间：%s\n买单:%s', curPrice, sellPrice, gridValue, quotaAssert, Date.now(), quotaOrder)
                }
            }
            buyPrice = (curPrice * (1 - gridRate)).toPrecision(5);
            sellPrice = (curPrice * (1 + gridRate)).toPrecision(5);
            setTimeout(() => {
                orderCallback(baseOrder.orderId, quotaOrder.orderId)
            }, 1000 * 2)
        }
    } catch (err) {
        console.error(err);
    }
}


async function Main() {
    // 获取最新汇率
    curPrice = await getCurPrice();
    if ((sideUp && startPrice < curPrice) || (!sideUp && startPrice > curPrice)) {
        // 看涨、但是启动价格还低于当前价格
        // 看跌、但是启动价格还高于当前价格
        // 延迟启动
        console.log('看涨？:[%s],启动价格:[%s],当前价格:[%s],延迟启动...', sideUp, startPrice, curPrice)
        setTimeout(Main, 1000 * 60)
    } else {
        console.log('启动...')
        buyPrice = (curPrice * (1 - gridRate)).toPrecision(5);
        sellPrice = (curPrice * (1 + gridRate)).toPrecision(5);
        console.log('初始汇率:%s 下一买入汇率:%s 下一卖出汇率:%s', curPrice, buyPrice, sellPrice)
        // 每 5 秒轮询一次
        setInterval(gridLoop, 1000 * 5)
    }
}

Main().catch(e => console.log(e))