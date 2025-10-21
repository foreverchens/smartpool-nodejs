import config from "../common/Config.js";
import smartPoolService from "./SmartPoolService.js";

// 默认周期用于兜底传参
const defaultCycleHours = config.CYCLE[0];

export default async function ({symbol, idx, len, cycleHours}) {
    let st = Date.now();
    const hours = Number(cycleHours) || defaultCycleHours;
    try {
        return await smartPoolService.analyze(symbol, hours);
    } catch (err) {
        console.log(err.message);
        return {};
    } finally {
        console.log(`进度 ${idx + 1}-->${len} : ${symbol}  耗时：${Date.now() - st}`);
    }
};
