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
        printArr[key].push(rlt);
    }
    printArr.forEach(arr => console.table(arr.sort((e1, e2) => e2.score - e1.score)
        .slice(0, Math.min(5, arr.length))))
}

async function run() {
    let rltArr = [];
    let symbolList = await czClient.listSymbol();
    let st = Date.now();
    const tasks = symbolList.map((symbol, idx) => {
        return threadPool.run([symbol, idx, symbolList.length]);
    });
    rltArr = await Promise.all(tasks);
    let et = Date.now();
    console.log('耗时: %s秒', (et - st) / 1000);
    // 根据振幅分组、然后打印输出
    printArr(rltArr);
}

async function Main() {
    await run();
    setInterval(run, 1000 * 60 * 60)
}

Main().then(ele => console.log("~~~running~~~"));