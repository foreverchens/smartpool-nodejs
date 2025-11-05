/** =============================================
 * 2) 结构体（JSDoc 注释；仅帮助理解，不影响运行）
 * =============================================
 * @typedef {Object} CreateParams  // 创建参数：必须在创建时提供
 * @property {string} id
 * @property {string} baseAssert      // 例如 'ETHUSDT'
 * @property {string} quoteAssert     // 例如 'BTCUSDT'；单币可与 base 相同
 * @property {boolean} doubled        // true=单币；false=双币/合成
 * @property {boolean} reversed       // 仅对单币场景有意义；本模板未使用
 * @property {number=} startPrice     // 启动触发价；未指定则首次价格即为锚点
 * @property {takeProfitPrice=} takeProfitPrice // 止盈价格
 * @property {number} gridRate        // 等比网格比率，如 0.005
 * @property {number} gridValue       // 每格交易价值（USDT）
 * @property {{baseQtyLvl?: number, quoteQtyLvl?: number}=} initPosition // 启动后一次性建仓数量倍数；正数买入、负数卖出
 *
 * @typedef {Object} RuntimeParams    // 运行时参数：由引擎在启动时生成
 * @property {number=} baseQty
 * @property {number=} quotaQty
 * @property {number} buyPrice
 * @property {number} sellPrice
 * @property {string=} RUNNINGGroupId  // 当前网格回合的分组ID（有挂单未完成时存在）
 * @property {number} lastTradePrice  // 最近一次成交价（作为下一格的锚点）
 *
 *
 * @typedef {Object} Order            // 一个委托订单（单币=1个；双币=2个）
 * @property {string} id
 * @property {string} taskId
 * @property {string} symbol
 * @property {'BUY'|'SELL'} side
 * @property {number} price
 * @property {number} qty
 * @property {'NEW'|'FILLED'|'CANCELLED'} status
 * @property {string} groupId         // 归属的网格回合ID；同组全部 FILLED 代表本格完成
 */
import dayjs from "dayjs";
import fs from 'fs';
import path from 'path';
import {fileURLToPath} from 'url';
import {subscribe, unsubscribe} from "./common/BockTickerManage.js"
import logger from './common/logger.js';
import {dealOrder, dealTask, tryStart} from './GridTaskHandler.js';


const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);


// 任务状态
const STATUS = {
    PENDING: 'PENDING', RUNNING: 'RUNNING', EXPIRED: 'EXPIRED',
};

// 文件路径
const TASKS_FILE = path.resolve(__dirname, './data/grid_tasks.json');     // 输入：网格任务“创建参数”列表
// 订单队列
let orderList = [];
// 定时循环周期（毫秒）
const TICK_MS = 1000;


/**
 * 获取网格任务列表
 */
function listGridTask() {
    let taskListRaw = [];
    try {
        const txt = fs.readFileSync(TASKS_FILE, 'utf8');
        taskListRaw = JSON.parse(txt);
    } catch (err) {
        logger.error('[Manager] 读取 grid_tasks.json 失败:', err?.message ?? err);
        return [];
    }

    return taskListRaw
        .filter(task => {
            let rlt = validateParams(task);
            if (rlt.errors.length) {
                logger.error(`id:${task.id ?? 'UNKNOWN'} 校验失败: ${rlt.errors.join(', ')}`);
            }
            return rlt.valid;
        })
        .map(task => ({
            ...task, status: task.status || STATUS.PENDING, runtime: task.runtime ?? null,
        }));
}

/**
 * 网格任务参数校验
 */
function validateParams(gridTask) {
    const errors = [];
    if (!gridTask || typeof gridTask !== 'object') {
        errors.push('参数需为对象');
        return {valid: false, errors};
    }

    const ensureString = (key) => {
        const value = gridTask[key];
        if (typeof value !== 'string' || !value.trim()) {
            errors.push(`${key} 不能为空`);
        }
    };
    const ensureBoolean = (key) => {
        if (typeof gridTask[key] !== 'boolean') {
            errors.push(`${key} 必须为布尔值`);
        }
    };
    const ensureNumber = (key) => {
        const value = gridTask[key];
        if (typeof value !== 'number' || !Number.isFinite(value)) {
            errors.push(`${key} 必须为数值`);
        }
    };

    ensureString('id');
    ensureString('baseAssert');
    ensureString('quoteAssert');
    ensureBoolean('doubled');
    ensureBoolean('reversed');
    ensureNumber('gridRate');
    ensureNumber('gridValue');

    if (gridTask.startPrice != null && (typeof gridTask.startPrice !== 'number' || !Number.isFinite(gridTask.startPrice))) {
        errors.push('startPrice 如存在必须为数值');
    }
    if (gridTask.takeProfitPrice != null && (typeof gridTask.takeProfitPrice !== 'number' || !Number.isFinite(gridTask.takeProfitPrice))) {
        errors.push('takeProfitPrice 如存在必须为数值');
    }

    if (gridTask.initPosition != null) {
        if (typeof gridTask.initPosition !== 'object' || Array.isArray(gridTask.initPosition)) {
            errors.push('initPosition 必须为对象');
        } else {
            const {baseQtyLvl, quoteQtyLvl} = gridTask.initPosition;
            if (baseQtyLvl != null && (!Number.isInteger(baseQtyLvl))) {
                errors.push('initPosition.baseQtyLvl 必须为整数');
            }
            if (quoteQtyLvl != null && (!Number.isInteger(quoteQtyLvl))) {
                errors.push('initPosition.quoteQtyLvl 必须为整数');
            }
        }
    }

    if (gridTask.extraBuys != null) {
        if (!Array.isArray(gridTask.extraBuys)) {
            errors.push('extraBuys 必须为数组');
        } else {
            for (const item of gridTask.extraBuys) {
                if (!item || typeof item !== 'object') {
                    errors.push('extraBuys 项必须为对象');
                    break;
                }
                const {price, mul} = item;
                if (price == null || typeof price !== 'number' || !Number.isFinite(price) || price <= 0) {
                    errors.push('extraBuys.price 必须为正数');
                    break;
                }
                if (mul == null || typeof mul !== 'number' || !Number.isFinite(mul) || mul <= 0) {
                    errors.push('extraBuys.mul 必须为正数');
                    break;
                }
            }
        }
    }

    return {valid: errors.length === 0, errors};
}

function updateTasks(tasks) {
    try {
        fs.writeFileSync(TASKS_FILE, JSON.stringify(tasks, null, 4));
    } catch (err) {
        logger.error('[Manager] 写入 grid_tasks.json 失败:', err?.message ?? err);
    }
}


/**
 * 主循环单步：
 */
async function loop() {

    const gridTaskList = listGridTask();

    if (!gridTaskList.length) {
        logger.error('[Manager] 未读取到有效的网格任务配置');
        return;
    }
    let time = 1;
    // 2.遍历网格任务列表
    for (const task of gridTaskList) {
        switch (task.status) {
            case STATUS.PENDING: {
                const startRlt = await tryStart(task);
                if (startRlt.suc) {
                    // 启动成功 订阅报价
                    subscribe(task.baseAssert);
                    if (task.doubled) {
                        subscribe(task.quoteAssert);
                    }
                    if (Array.isArray(startRlt.data) && startRlt.data.length) {
                        for (const order of startRlt.data) {
                            orderList.push(order);
                        }
                    }
                }
                break;
            }
            case STATUS.RUNNING:
                let callRlt = await dealTask(task);
                if (callRlt.suc) {
                    switch (callRlt.code) {
                        case 1:
                            // loop等待中
                            time = callRlt.time;
                            break;
                        case 2:
                            // grid trade orders handler
                            time = callRlt.time;
                            if (callRlt.data) {
                                for (let order of callRlt.data) {
                                    orderList.push(order);
                                }
                            }
                            break;
                        case 3:
                            // grid profit orders handler
                            time = callRlt.time;
                            if (callRlt.data) {
                                for (let order of callRlt.data) {
                                    orderList.push(order);
                                }
                            }
                            task.status = STATUS.EXPIRED;
                            task.reason = 'Take profit';
                            break;
                        default:
                            console.log(0)
                    }
                } else {
                    logger.error(callRlt.msg);
                    // 运行时异常、失效任务
                    task.status = STATUS.EXPIRED;
                    task.reason = callRlt.msg;
                }
                break
            default:
                unsubscribe(task.baseAssert);
                if (task.doubled) {
                    unsubscribe(task.quoteAssert)
                }
        }
    }
    // 更新任务列表
    updateTasks(gridTaskList);

    // 启动下一步循环
    setTimeout(async () => {
        await loop().catch(err => {
            logger.error('[ERR] Tick loop 异常:', err?.message ?? err)
        })
        // 多任务时 time会直接取最后一次更新的值
    }, time ? TICK_MS * time : TICK_MS);
}

/**
 * 启动网格任务管理器：
 *  - 立即执行一次 tick()
 *  - 每隔 TICK_MS 周期性执行
 */
export async function start() {
    // 扫描任务列表、订阅相关报价
    const gridTaskList = listGridTask();
    gridTaskList.forEach(ele => {
        if (ele.status === STATUS.RUNNING) {
            subscribe(ele.baseAssert);
            if (ele.doubled) {
                subscribe(ele.quoteAssert);
            }
        }
    });

    // 启动网格任务调度循环
    await loop().then(ele => {
        console.log(dayjs().toJSON())
    }).catch(err => {
        logger.error('[ERR] Tick loop 异常:', err?.message ?? err)
    });

    // 启动挂单追踪同步脚本
    setInterval(async () => {
        try {
            await dealOrder(orderList);
        } catch (err) {
            logger.error('[Manager] 定时检查订单异常:', err?.message ?? err);
        }
    }, TICK_MS);


}
