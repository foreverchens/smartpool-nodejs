const config = require("./common/Config")
const czClient = require("./service/CzClient.js")
const {setInterval} = require('timers');
const {Piscina} = require('piscina');
const path = require('path');
const threadPool = new Piscina({
    filename: path.resolve(__dirname, './service/worker.js'), maxThreads: config.MAX_THREADS
});

function printArrByRate(rltArr) {
    let printArr = [[], [], [], [], []];
    for (let rlt of rltArr) {
        let key = rlt.amplitude < 2 || rlt.amplitude >= 10 ? 0 : Math.trunc(rlt.amplitude / 2);
        if (!printArr[key]) {
            continue;
        }
        if (rlt.symbol.endsWith('USDT') && rlt.score < 10000) {
            continue;
        }
        if (!rlt.symbol.endsWith('USDT') && rlt.score < 5000) {
            continue;
        }
        printArr[key].push(rlt);
    }
    printArr
        .filter(arr => arr.length !== 0).forEach(arr => console.table(arr.sort((e1, e2) => e2.score - e1.score)
        .slice(0, Math.min(5, arr.length))))
}

function printArrByPosit(rltArr) {
    let downList = rltArr.filter(ele => ele.pricePosition < -0.1)
        .sort((a, b) => a.pricePosition - b.pricePosition)
    let upList = rltArr.filter(ele => ele.pricePosition > 1.1).sort((a, b) => b.pricePosition - a.pricePosition)
    let centerList = rltArr.filter(ele => ele.pricePosition > -0.1 && ele.pricePosition < 1.1).sort((a, b) => b.pricePosition - a.pricePosition)
    console.table(downList);
    console.table(upList);
    console.table(centerList);
}

async function run() {
    let rltArr = [];
    let symbolList = await czClient.listSymbol();
    let st = Date.now();
    rltArr = await Promise.all(symbolList.map((symbol, idx) => {
        return threadPool.run([symbol, idx, symbolList.length]);
    }));
    let et = Date.now();
    console.log('耗时: %s秒', (et - st) / 1000);
    // 根据振幅分组、然后打印输出
    // 合约
    // printArrByRate(rltArr.filter(ele => ele.symbol && ele.symbol.endsWith('USDT')));
    // // 汇率
    // printArrByRate(rltArr.filter(ele => ele.symbol && ele.symbol.endsWith('BTC')));
    // printArrByRate(rltArr.filter(ele => ele.symbol && ele.symbol.endsWith('ETH')));
    // printArrByRate(rltArr.filter(ele => ele.symbol && ele.symbol.endsWith('BNB')));

    rltArr = rltArr.filter(ele => ele.score > 5000 && ele.symbol && ele.symbol.endsWith('BTC'))
    /**
     *  对btc汇率小于-0.1、弱势、反弹可能弱
     *  对btc汇率大于1.1、强势、回调可能弱
     *  [-0.1,1.1]内震荡最佳
     */
    let centerList = rltArr.filter(ele => ele.pricePosition > -0.1 && ele.pricePosition < 1.1).sort((a, b) => b.pricePosition - a.pricePosition)
    /**
     * 将处于震荡的币分为高低两组、[0.8,1.1]为高位组、[-0.1,0.2]为低位组、以高位组为base做空、低位组为quota做多、势能最大
     */
    let highList = centerList
        .filter(ele => ele.pricePosition > 0.8 && ele.amplitude < 10)
        .sort((a, b) => b.score - a.score);
    let lowList = centerList
        .filter(ele => ele.pricePosition < 0.2  && ele.amplitude < 10)
        .sort((a, b) => b.score - a.score);
    console.table(highList);
    console.table(lowList);
    highList = highList.map(ele => ele.symbol.replace('-BTC', ''));
    lowList = lowList.map(ele => ele.symbol.replace('-BTC', ''));
    let highLowList = []
    highList.forEach(e1 => {
        lowList.forEach(e2 => {
            highLowList.push(e1 + '-' + e2)
        })
    })
    console.log(highLowList);
    rltArr = await Promise.all(highLowList.map((symbol, idx) => {
        return threadPool.run([symbol, idx, highLowList.length]);
    }));
    console.log('rlt:\n')
    console.table(rltArr);
}

async function Main() {
    await run();
    setInterval(run, 1000 * 60 * 60)
}

Main().then(ele => console.log("~~~running~~~"));