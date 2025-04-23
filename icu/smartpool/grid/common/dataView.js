const fs = require('fs')
let content = fs.readFileSync('./TRXUSDT_BNBUSDC_database.txt', 'utf-8');
const data = content.split(/\r?\n/);
data.pop()
// console.table(data.map(ele => ele.split(',')));;
const result = {};
for (const line of data) {
    const [symbol, side, , priceStr, amountStr] = line.split(',');
    const price = parseFloat(priceStr);
    const amount = parseFloat(amountStr);

    if (!result[symbol]) {
        result[symbol] = {
            BUY: {totalAmount: 0, totalCost: 0},
            SELL: {totalAmount: 0, totalRevenue: 0}
        };
    }

    if (side === 'BUY') {
        result[symbol].BUY.totalAmount += amount;
        result[symbol].BUY.totalCost += price * amount;
    } else {
        result[symbol].SELL.totalAmount += amount;
        result[symbol].SELL.totalRevenue += price * amount;
    }
}
const summary = {};
for (const symbol in result) {
    const buy = result[symbol].BUY;
    const sell = result[symbol].SELL;

    // 平均价格
    const avgBuyPrice = buy.totalAmount > 0 ? buy.totalCost / buy.totalAmount : 0;
    const avgSellPrice = sell.totalAmount > 0 ? sell.totalRevenue / sell.totalAmount : 0;

    // 已实现利润计算（取 min(买入数量, 卖出数量) 作为成交量）
    const matchedAmount = Math.min(buy.totalAmount, sell.totalAmount);
    const realizedProfit = matchedAmount * (avgSellPrice - avgBuyPrice);

    summary[symbol] = {
        buy: {
            avgP: avgBuyPrice.toPrecision(5),
            totalVol: (buy.totalAmount * avgBuyPrice).toFixed(0)
        },
        sell: {
            avgP: avgSellPrice.toPrecision(5),
            totalAmount: (sell.totalAmount * avgSellPrice).toFixed(0)
        },
        realizedProfit: realizedProfit.toPrecision(3)
    };
}
console.table(summary);
