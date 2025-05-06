import smartPoolService from "./SmartPoolService.js"
import config from "../common/Config.js"

export default async function ([symbol, idx, len]) {
    let st = Date.now();
    try {
        return await smartPoolService.analyze(symbol, config.CYCLE);
    } catch (err) {
        console.log(err.message);
        return {};
    } finally {
        console.log(`进度 ${idx + 1}-->${len} : ${symbol}  耗时：${Date.now() - st}`);
    }
};

