import {readdir, readFile} from 'fs/promises';
import {join, extname, resolve} from 'path';
import czClient from './CzClient.js'

async function scanFiles(dirPath) {
    let result = [];
    const entries = await readdir(dirPath, {withFileTypes: true});
    for (const entry of entries) {
        const fullPath = join(dirPath, entry.name);
        if (entry.isDirectory()) {
            const subFiles = await scanFiles(fullPath);
            result.push(...subFiles);
        } else if ('.txt' === (extname(entry.name))) {
            result.push(fullPath);
        }
    }
    return result;
}

async function dataHandle(fileList) {
    let summary = {}
    for (let fileName of fileList) {
        const fullFilePath = resolve('./'.concat(fileName));
        let content = await readFile(fullFilePath, 'utf-8');
        const data = content.split(/\r?\n/);
        data.pop()

        const result = {};
        for (const line of data) {
            const [symbol, side, , priceStr, amountStr] = line.split(',');
            const price = parseFloat(priceStr);
            const amount = parseFloat(amountStr);
            if (!result[symbol]) {
                result[symbol] = {
                    BUY: {totalAmount: 0, totalVol: 0}, SELL: {totalAmount: 0, totalVol: 0}
                };
            }
            if (side === 'BUY') {
                result[symbol].BUY.totalAmount += amount;
                result[symbol].BUY.totalVol += price * amount;
            } else {
                result[symbol].SELL.totalAmount += amount;
                result[symbol].SELL.totalVol += price * amount;
            }
        }
        for (const symbol in result) {
            const buy = result[symbol].BUY;
            const sell = result[symbol].SELL;
            // 平均价格
            const avgBuyPrice = buy.totalAmount > 0 ? buy.totalVol / buy.totalAmount : 0;
            const avgSellPrice = sell.totalAmount > 0 ? sell.totalVol / sell.totalAmount : 0;
            // 已实现利润计算（取 min(买入数量, 卖出数量) 作为成交量）
            const matchedAmount = Math.min(buy.totalAmount, sell.totalAmount);
            const realizedProfit = matchedAmount * (avgSellPrice - avgBuyPrice);
            const txFeeRlt = await czClient.getTotalCommission(symbol);
            summary[symbol] = {
                buy: {
                    avgP: avgBuyPrice.toPrecision(5), totalVol: (buy.totalAmount * avgBuyPrice).toFixed(0)
                }, sell: {
                    avgP: avgSellPrice.toPrecision(5), totalVol: (sell.totalAmount * avgSellPrice).toFixed(0)
                }, totalTxFee: txFeeRlt.totalTxFee.toFixed(2) + '$',
                limitRate: txFeeRlt.limitRate,
                realizedProfit: (realizedProfit - txFeeRlt.totalTxFee).toPrecision(3)
            };
        }
    }
    return summary;
}

async function loop() {
    let fileList = await scanFiles('./');
    await dataHandle(fileList).then(rlt => {
        console.table(rlt);
        console.log('已实现盈利: %s$', Object.values(rlt)
            .map(ele => ele.realizedProfit)
            .reduce((ele, num) => Number(ele) + Number(num), 0).toFixed(1))
    });
    Promise.all([czClient.getFuturesAccount(), czClient.getFuturesPrice('BTCUSDT'), czClient.getFuturesPositionRisk()])
        .then(([balanceAccount, price, postList]) => {
            let balance = 0;
            balanceAccount.forEach(ele => {
                if (ele.asset === 'USDT' || ele.asset === 'USDC') {
                    balance += Number(ele.marginBalance)
                }
            })
            let long = 0;
            let short = 0;
            let btcPost = 0;
            postList.forEach(ele => {
                let notional = Number(ele.notional);
                if (ele.symbol.startsWith('BTCUSD')) {
                    btcPost += notional;
                    return
                }
                if (notional > 0) {
                    long += notional
                } else {
                    short -= notional;
                }
            })
            console.log('当前时间: %s \nBTC价格: %s\n当前余额: %s ', new Date().toLocaleTimeString(), price, balance.toFixed(0))
            let rlt = {}
            if (btcPost) {
                rlt.BTC = {
                    Val: btcPost.toFixed(0), lev: (btcPost / balance).toFixed(1)
                }
            }
            rlt.long = {
                Val: long.toFixed(0), lev: (long / balance).toFixed(1)
            };
            rlt.short = {
                Val: short.toFixed(0), lev: (short / balance).toFixed(1)
            }

            console.table(rlt);
        })
}

await loop()
setInterval(loop, 1000 * 60 * 60)
process.stdin.on('data', (input) => {
    loop().catch(e => console.log(e))
});


