const config = require("./common/Config")
const czClient = require("./service/CzClient")
const {setInterval} = require('timers');
const {Piscina} = require('piscina');
const path = require('path');
const threadPool = new Piscina({
    filename: path.resolve(__dirname, './service/worker.js'), maxThreads: config.MAX_THREADS
});

function printArr(rltArr) {
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
    printArr(rltArr.filter(ele => ele.symbol && ele.symbol.endsWith('USDT')));
    // 汇率
    printArr(rltArr.filter(ele => ele.symbol && !ele.symbol.endsWith('USDT')));
}

async function Main() {
    await run();
    setInterval(run, 1000 * 60 * 60)
}

Main().then(ele => console.log("~~~running~~~"));