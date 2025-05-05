const smartPoolService = require("./SmartPoolService");
const config = require("../common/Config");

module.exports = async function ([symbol,idx,len]) {
    let st = Date.now();
    try {
        console.log(`进度 ${idx+1}-->${len} : ${symbol}`);
        return await smartPoolService.analyze(symbol, config.CYCLE);
    } catch (err) {
        console.log(err.message);
        return {};
    }finally {
        console.log(Date.now() - st)
    }
};

