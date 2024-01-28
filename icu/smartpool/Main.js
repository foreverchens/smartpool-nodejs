const czClient = require("./service/CzClient")
const config = require("./common/Config")
const smartPoolService = require("./service/SmartPoolService")
const {setInterval} = require('timers');

async function run() {
    console.log("~~~start~~~")
    let symbolList = await czClient.listSymbol()
    let rltArr = [];
    for (let symbol of symbolList) {
        console.log("~~~start %s~~~", symbol)
        try {
            let rlt = await smartPoolService.analyze(symbol, config.CYCLE);
            rltArr.push(rlt);
        } catch (error) {
            console.error('err msg:', error.message);
        }
    }

    let map = new Map([[0, []], [1, []], [2, []], [3, []], [4, []]]);
    for (let rlt of rltArr) {
        let key = rlt.amplitude < 2 || rlt.amplitude >= 10 ? 0 : Math.trunc(rlt.amplitude / 2);
        map.get(key).push(rlt);
    }
    for (let i = 4; i >= 0; i--) {
        let arr = map.get(i);
        if (arr.length === 0) {
            continue;
        }
        arr.sort((e1, e2) => e2.score - e1.score);
        console.log("~~~~[%s]~~~~", i)
        arr.slice(0, Math.min(5, arr.length)).forEach(ele => console.log(ele));
    }
    console.log("~~~end~~~")
}

async function Main() {
    await run();
    setInterval(run, 1000 * 60 * 60)
}

Main().then(ele => console.log("~~~running~~~"));