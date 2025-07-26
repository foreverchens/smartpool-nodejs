import config from "./common/Config.js";
import czClient from "./service/CzClient.js";
import {setInterval} from "timers";
import Piscina from "piscina";
import path from "path";
import fs from "fs"

const threadPool = new Piscina({
    filename: path.resolve('./service/worker.js'), maxThreads: config.MAX_THREADS
});

let l = 0;
async function run() {
    /**
     * 获取币种震荡数据
     */
    let symbolList = await czClient.listSymbol();
    symbolList = symbolList.slice(0,l += 2);
    // symbolList = ['BTCUSDT','ETHUSDT','LTCUSDT','XRPUSDT'];
    console.log(symbolList);
    let st = Date.now();
    let rltArr = await Promise.all(symbolList.map((symbol, idx) => {
        return threadPool.run([symbol, idx, symbolList.length]);
    }));
    let et = Date.now();
    console.log('耗时: %s秒', (et - st) / 1000);
    console.log("----------BTC锚定币币对原始分析数据----------")
    console.table(rltArr);
    console.log("----------BTC锚定币币对原始分析数据----------")


    /**
     *  简单过滤
     *  对btc汇率位置低于-0.1、弱势、反弹可能弱
     *  对btc汇率位置高于1.1、强势、回调可能弱
     *  [-0.1,1.1]内震荡最佳
     */
    rltArr = rltArr.filter(ele => ele.score > 5000 && ele.symbol && ele.symbol.endsWith('BTC'))
    let centerList = rltArr.filter(ele => ele.pricePosit > -0.1 && ele.pricePosit < 1.1)
        .sort((a, b) => b.pricePosit - a.pricePosit)

    console.log("----------对得分和价格位置过滤后数据----------")
    console.table(centerList);
    console.log("----------对得分和价格位置过滤后数据----------")

    let len = centerList.length;
    /**
     * 将处于震荡的币分为高低两组、[0.8,1.1]为高位组、[-0.1,0.2]为低位组、以低位组为base做多、高位组为quota做空、势能最大
     */
    let highList = centerList.slice(0, len * 0.5)
        .sort((a, b) => b.score - a.score)
        .slice();
    let lowList = centerList
        .slice(len * -0.5)
        .sort((a, b) => b.score - a.score);
    console.log("----------价格高位组数据----------")
    console.table(highList);
    console.log("----------价格高位组数据----------")
    console.log("----------价格地位组数据----------")
    console.table(lowList);
    console.log("----------价格地位组数据----------")

    highList = highList.slice(0, highList.length > 5 ? 5 : highList.length);
    lowList = lowList.slice(0, lowList.length > 5 ? 5 : lowList.length);
    /**
     *  两者组装为币币交易对、获取震荡指标
     */
    lowList = lowList.map(ele => ele.symbol.replace('-BTC', ''));
    let highLowList = []
    highList.map(ele => ele.symbol.replace('-BTC', '')).forEach(e1 => {
        lowList.forEach(e2 => {
            highLowList.push(e2 + '-' + e1)
        })
    })
    console.log("----------双币币对列表----------")
    console.table(highLowList);
    console.log("----------双币币对列表----------")
    rltArr = await Promise.all(highLowList.map((symbol, idx) => {
        return threadPool.run([symbol, idx, highLowList.length]);
    }));
    let data = rltArr.sort((a, b) => b.score - a.score);
    console.log("----------双币币对分析数据----------")
    console.table(data);
    console.log("----------双币币对分析数据----------")
    fs.writeFileSync('./other/outlog/smartpool.json', JSON.stringify(data));
}

await run();
setInterval(run, 1000 * 60 * 60)
