const dashboardState = {
    orders: [],
    tasks: [],
    gridTasks: [],
    selectedTaskId: null,
    fieldSnapshot: new Map(),
    isRefreshing: false,
    refreshTimerId: null,
    orderKeySnapshot: new Set(),
    lastNewOrderKeys: new Set(),
    expandedTaskBlocks: new Map(),
    expandedArbitrages: new Map(),
    arbitragePage: new Map()
};

const DEFAULT_DECIMALS = 4;
const PRICE_PRECISION = 5;
const FEE_DECIMALS = 5;
const ARBITRAGE_PAGE_SIZE = 5;

const taskSelectorEl = document.getElementById('grid-task-selector');
if (taskSelectorEl) {
    taskSelectorEl.addEventListener('change', event => {
        updateSelectedTaskId(event.target.value);
    });
}

async function loadOrders(taskId) {
    const query = taskId ? `?taskId=${encodeURIComponent(taskId)}` : '';
    const res = await fetch(`/api/orders${query}`, {cache: 'no-store'});
    if (!res.ok) {
        throw new Error(`无法加载订单数据：${res.status} ${res.statusText}`);
    }
    return res.json();
}

async function loadGridTasks() {
    const res = await fetch('../grid/data/grid_tasks.json', {cache: 'no-store'});
    if (!res.ok) {
        throw new Error(`无法加载网格任务数据：${res.status} ${res.statusText}`);
    }
    return res.json();
}

function normalizeOrders(rawOrders) {
    return rawOrders.map(order => {
        const price = safeNumber(order.price);
        const quantity = safeNumber(order.origQty);
        const updateTime = safeNumber(order.updateTime);
        const txFee = safeNumber(order.txFee);
        const makerParticipation = parseMakerFeeRate(order.makerFeeRate);
        const makerFee = Number.isFinite(txFee) && makerParticipation !== null ? txFee * makerParticipation : 0;
        const takerFee = Number.isFinite(txFee) ? Math.max(txFee - makerFee, 0) : 0;
        const takerParticipation = makerParticipation !== null ? Math.max(1 - makerParticipation, 0) : null;
        return {
            ...order,
            price,
            quantity,
            notional: price * quantity,
            updateTime,
            txFee,
            makerFee,
            takerFee,
            makerParticipation,
            takerParticipation
        };
    }).filter(order => Number.isFinite(order.updateTime));
}

function toNumberOrNull(value) {
    if (value === undefined || value === null) {
        return null;
    }
    if (typeof value === 'string' && value.trim() === '') {
        return null;
    }
    const num = Number(value);
    return Number.isFinite(num) ? num : null;
}

function normalizeGridTasks(rawTasks) {
    if (!Array.isArray(rawTasks)) {
        return [];
    }
    return rawTasks.map(task => {
        const runtime = task && typeof task === 'object' ? task.runtime || {} : {};
        const initPosition = normalizeInitPosition(task?.initPosition);
        const id = String(task?.id ?? task?.taskId ?? '未命名任务').trim() || '未命名任务';
        const status = task?.status ? String(task.status).toUpperCase() : 'UNKNOWN';
        return {
            id,
            baseAsset: task?.baseAsset ?? task?.baseAssert ?? '',
            quoteAsset: task?.quoteAsset ?? task?.quoteAssert ?? '',
            doubled: Boolean(task?.doubled),
            reversed: Boolean(task?.reversed),
            startPrice: toNumberOrNull(task?.startPrice),
            startBaseP: toNumberOrNull(task?.startBaseP),
            startQuoteP: toNumberOrNull(task?.startQuoteP),
            gridRate: toNumberOrNull(task?.gridRate),
            gridValue: toNumberOrNull(task?.gridValue),
            status,
            initPosition,
            runtime: {
                baseQty: toNumberOrNull(runtime.baseQty),
                quoteQty: toNumberOrNull(runtime.quoteQty),
                buyPrice: toNumberOrNull(runtime.buyPrice),
                sellPrice: toNumberOrNull(runtime.sellPrice),
                lastTradePrice: toNumberOrNull(runtime.lastTradePrice),
                initFilled: normalizeInitFilled(runtime.initFilled)
            }
        };
    });
}

function normalizeInitPosition(rawInitPosition) {
    if (!rawInitPosition || typeof rawInitPosition !== 'object') {
        return null;
    }
    const baseQty = toNumberOrNull(rawInitPosition.baseQty);
    const quoteQty = toNumberOrNull(rawInitPosition.quoteQty);
    if (baseQty === null && quoteQty === null) {
        return null;
    }
    return {baseQty, quoteQty};
}

function normalizeInitFilled(rawInitFilled) {
    if (!Array.isArray(rawInitFilled)) {
        return [];
    }
    return rawInitFilled.map(entry => {
        const orderId = entry?.orderId !== undefined && entry?.orderId !== null
            ? String(entry.orderId)
            : null;
        const symbol = typeof entry?.symbol === 'string' ? entry.symbol : '';
        const side = typeof entry?.side === 'string' ? entry.side.toUpperCase() : '';
        const quantity = toNumberOrNull(entry?.qty ?? entry?.quantity ?? entry?.origQty);
        const price = toNumberOrNull(entry?.price);
        return {
            orderId,
            symbol,
            side,
            quantity,
            price
        };
    }).filter(entry => {
        if (entry.orderId) {
            return true;
        }
        return Boolean(entry.symbol && entry.side && Number.isFinite(entry.quantity) && Number.isFinite(entry.price));
    });
}

function accumulateInitialExposure(target, taskId, order) {
    if (!taskId) {
        return;
    }
    if (!target.has(taskId)) {
        target.set(taskId, new Map());
    }
    const symbol = order?.symbol ? String(order.symbol).toUpperCase() : 'UNKNOWN';
    const symbolMap = target.get(taskId);
    if (!symbolMap.has(symbol)) {
        symbolMap.set(symbol, {
            qty: 0,
            notional: 0
        });
    }
    const entry = symbolMap.get(symbol);
    const quantity = Number.isFinite(order.quantity) ? order.quantity : safeNumber(order.origQty);
    const notional = Number.isFinite(order.notional) ? order.notional : (Number.isFinite(order.price) ? order.price * quantity : 0);
    if (order.side === 'SELL') {
        entry.qty -= quantity;
        entry.notional -= notional;
    } else {
        entry.qty += quantity;
        entry.notional += notional;
    }
}

function partitionInitialOrders(orders, gridTasks) {
    if (!Array.isArray(orders) || !orders.length || !Array.isArray(gridTasks) || !gridTasks.length) {
        return {
            filteredOrders: Array.isArray(orders) ? [...orders] : [],
            initialExposure: new Map()
        };
    }

    const tasksWithInitFilled = new Set();
    gridTasks.forEach(task => {
        if (Array.isArray(task.runtime?.initFilled) && task.runtime.initFilled.length) {
            tasksWithInitFilled.add(String(task.id));
        }
    });

    if (!tasksWithInitFilled.size) {
        return {
            filteredOrders: [...orders],
            initialExposure: new Map()
        };
    }

    const removalCounter = new Map();
    const initialExposure = new Map();
    const filteredOrders = [];
    orders.forEach(order => {
        const taskId = order?.taskId ? String(order.taskId) : null;
        if (!taskId || !tasksWithInitFilled.has(taskId)) {
            filteredOrders.push(order);
            return;
        }
        const consumed = removalCounter.get(taskId) || 0;
        if (consumed < 2) {
            removalCounter.set(taskId, consumed + 1);
            accumulateInitialExposure(initialExposure, taskId, order);
            return;
        }
        filteredOrders.push(order);
    });
    return {
        filteredOrders,
        initialExposure
    };
}

function safeNumber(value) {
    const num = Number(value);
    return Number.isFinite(num) ? num : 0;
}

function parseMakerFeeRate(value) {
    if (value === undefined || value === null || value === '') {
        return null;
    }
    if (typeof value === 'string') {
        const trimmed = value.trim();
        if (!trimmed) {
            return null;
        }
        const normalized = trimmed.endsWith('%') ? trimmed.slice(0, -1) : trimmed;
        const num = Number(normalized);
        if (Number.isFinite(num)) {
            return clampPercent(num);
        }
    } else {
        const num = Number(value);
        if (Number.isFinite(num)) {
            return clampPercent(num);
        }
    }
    return null;
}

function clampPercent(value) {
    const ratio = value > 1 ? value / 100 : value;
    if (!Number.isFinite(ratio)) {
        return null;
    }
    return Math.min(Math.max(ratio, 0), 1);
}

function computeRealizedMetrics(buyQty, sellQty, avgBuyPrice, avgSellPrice) {
    const matchedQty = Math.min(buyQty || 0, sellQty || 0);
    const hasBothSides = matchedQty > 0
        && Number.isFinite(avgBuyPrice)
        && Number.isFinite(avgSellPrice)
        && avgBuyPrice > 0
        && avgSellPrice > 0;
    const priceSpread = hasBothSides ? (avgSellPrice - avgBuyPrice) : 0;
    const realizedProfit = hasBothSides ? matchedQty * priceSpread : 0;
    return {
        matchedQty,
        priceSpread,
        realizedProfit
    };
}

function aggregateOrdersBySymbol(orders, side) {
    const map = new Map();
    (orders || []).forEach(order => {
        const symbol = order.symbol || 'UNKNOWN';
        if (!map.has(symbol)) {
            map.set(symbol, {
                symbol,
                side,
                quantity: 0,
                notional: 0,
                totalFee: 0,
                makerParticipationSum: 0,
                makerParticipationCount: 0,
                makerNotional: 0,
                participationNotional: 0,
                orderCount: 0,
                earliest: Number.POSITIVE_INFINITY,
                latest: Number.NEGATIVE_INFINITY,
                orders: []
            });
        }
        const entry = map.get(symbol);
        const quantity = Number.isFinite(order.quantity) ? order.quantity : 0;
        const notional = Number.isFinite(order.notional) ? order.notional : 0;
        entry.quantity += quantity;
        entry.notional += notional;
        if (Number.isFinite(order.txFee)) {
            entry.totalFee += order.txFee;
        }
        if (Number.isFinite(order.makerParticipation)) {
            entry.makerParticipationSum += order.makerParticipation;
            entry.makerParticipationCount += 1;
            entry.participationNotional += notional;
            entry.makerNotional += notional * order.makerParticipation;
        }
        entry.orderCount += 1;
        if (Number.isFinite(order.updateTime)) {
            entry.earliest = Math.min(entry.earliest, order.updateTime);
            entry.latest = Math.max(entry.latest, order.updateTime);
        }
        entry.orders.push(order);
    });
    return Array.from(map.values()).map(entry => ({
        ...entry,
        avgPrice: entry.quantity ? entry.notional / entry.quantity : 0,
        avgMakerParticipation: entry.makerParticipationCount
            ? entry.makerParticipationSum / entry.makerParticipationCount
            : null,
        makerOrderRatio: entry.participationNotional
            ? entry.makerNotional / entry.participationNotional
            : null,
        earliest: Number.isFinite(entry.earliest) ? entry.earliest : NaN,
        latest: Number.isFinite(entry.latest) ? entry.latest : NaN
    }));
}

function buildArbitrageSymbolLegs(arbitrage) {
    const buyLegs = aggregateOrdersBySymbol(arbitrage.buyOrders || [], 'BUY');
    const sellLegs = aggregateOrdersBySymbol(arbitrage.sellOrders || [], 'SELL');
    return [...buyLegs, ...sellLegs].sort((a, b) => {
        if (a.symbol === b.symbol) {
            if (a.side === b.side) {
                return 0;
            }
            return a.side.localeCompare(b.side);
        }
        return a.symbol.localeCompare(b.symbol);
    });
}

function buildTaskHierarchy(orders) {
    const tasksById = new Map();
    for (const order of orders) {
        const taskId = order.taskId || '未命名任务';
        if (!tasksById.has(taskId)) {
            tasksById.set(taskId, {
                taskId,
                symbolSet: new Set(),
                symbolMap: new Map(),
                arbitrages: new Map(),
                totalOrders: 0,
                buyCount: 0,
                sellCount: 0,
                buyNotional: 0,
                sellNotional: 0,
                totalFee: 0,
                makerFee: 0,
                takerFee: 0,
                makerParticipationSum: 0,
                makerParticipationCount: 0,
                makerNotional: 0,
                participationNotional: 0,
                start: Number.POSITIVE_INFINITY,
                end: -Infinity
            });
        }
        const task = tasksById.get(taskId);
        task.symbolSet.add(order.symbol);
        task.totalOrders += 1;
        task.start = Math.min(task.start, order.updateTime);
        task.end = Math.max(task.end, order.updateTime);
        if (order.side === 'BUY') {
            task.buyCount += 1;
            task.buyNotional += order.notional;
        } else if (order.side === 'SELL') {
            task.sellCount += 1;
            task.sellNotional += order.notional;
        }

        if (!task.symbolMap.has(order.symbol)) {
            task.symbolMap.set(order.symbol, {
                symbol: order.symbol,
                orderCount: 0,
                buyQty: 0,
                sellQty: 0,
                buyNotional: 0,
                sellNotional: 0,
                fee: 0,
                makerFee: 0,
                takerFee: 0,
                makerParticipationSum: 0,
                makerParticipationCount: 0,
                makerNotional: 0,
                participationNotional: 0,
                lastUpdate: -Infinity,
                lastPrice: NaN
            });
        }
        const symbolStats = task.symbolMap.get(order.symbol);
        symbolStats.orderCount += 1;
        symbolStats.lastUpdate = Math.max(symbolStats.lastUpdate, order.updateTime);
        if (Number.isFinite(order.price)) {
            symbolStats.lastPrice = order.price;
        }
        if (order.side === 'BUY') {
            symbolStats.buyQty += order.quantity;
            symbolStats.buyNotional += order.notional;
        } else if (order.side === 'SELL') {
            symbolStats.sellQty += order.quantity;
            symbolStats.sellNotional += order.notional;
        }
        if (Number.isFinite(order.txFee)) {
            task.totalFee += order.txFee;
            symbolStats.fee += order.txFee;
        }
        if (Number.isFinite(order.makerFee)) {
            task.makerFee += order.makerFee;
            symbolStats.makerFee += order.makerFee;
        }
        if (Number.isFinite(order.takerFee)) {
            task.takerFee += order.takerFee;
            symbolStats.takerFee += order.takerFee;
        }
        const bindId = order.taskBindId || '未分组批次';
        if (!task.arbitrages.has(bindId)) {
            task.arbitrages.set(bindId, {
                taskBindId: bindId,
                synthPrice: safeNumber(order.synthPrice),
                orders: [],
                buyOrders: [],
                sellOrders: [],
                buyNotional: 0,
                sellNotional: 0,
                buyQty: 0,
                sellQty: 0,
                totalFee: 0,
                makerFee: 0,
                takerFee: 0,
                makerParticipationSum: 0,
                makerParticipationCount: 0,
                makerNotional: 0,
                participationNotional: 0,
                start: Number.POSITIVE_INFINITY,
                end: -Infinity
            });
        }
        const arbitrage = task.arbitrages.get(bindId);
        arbitrage.orders.push(order);
        arbitrage.start = Math.min(arbitrage.start, order.updateTime);
        arbitrage.end = Math.max(arbitrage.end, order.updateTime);
        if (!arbitrage.synthPrice && order.synthPrice) {
            arbitrage.synthPrice = safeNumber(order.synthPrice);
        }
        if (order.side === 'BUY') {
            arbitrage.buyOrders.push(order);
            arbitrage.buyNotional += order.notional;
            arbitrage.buyQty += order.quantity;
        } else if (order.side === 'SELL') {
            arbitrage.sellOrders.push(order);
            arbitrage.sellNotional += order.notional;
            arbitrage.sellQty += order.quantity;
        }
        if (Number.isFinite(order.txFee)) {
            arbitrage.totalFee += order.txFee;
        }
        if (Number.isFinite(order.makerFee)) {
            arbitrage.makerFee += order.makerFee;
        }
        if (Number.isFinite(order.takerFee)) {
            arbitrage.takerFee += order.takerFee;
        }
        if (Number.isFinite(order.makerParticipation)) {
            const makerPart = order.makerParticipation;
            const orderNotional = order.notional;
            const makerNotionalShare = orderNotional * makerPart;
            task.makerParticipationSum += makerPart;
            task.makerParticipationCount += 1;
            task.makerNotional += makerNotionalShare;
            task.participationNotional += orderNotional;
            symbolStats.makerParticipationSum += makerPart;
            symbolStats.makerParticipationCount += 1;
            symbolStats.makerNotional += makerNotionalShare;
            symbolStats.participationNotional += orderNotional;
            arbitrage.makerParticipationSum += makerPart;
            arbitrage.makerParticipationCount += 1;
            arbitrage.makerNotional += makerNotionalShare;
            arbitrage.participationNotional += orderNotional;
        }
    }

    return Array.from(tasksById.values())
        .map(task => {
            const arbitrages = Array.from(task.arbitrages.values())
                .map(arbitrage => {
                    const avgBuyPrice = arbitrage.buyQty ? arbitrage.buyNotional / arbitrage.buyQty : 0;
                    const avgSellPrice = arbitrage.sellQty ? arbitrage.sellNotional / arbitrage.sellQty : 0;
                    const {matchedQty, priceSpread, realizedProfit} = computeRealizedMetrics(
                        arbitrage.buyQty,
                        arbitrage.sellQty,
                        avgBuyPrice,
                        avgSellPrice
                    );
                    const symbolLegs = buildArbitrageSymbolLegs(arbitrage);
                    return {
                        ...arbitrage,
                        profit: arbitrage.sellNotional - arbitrage.buyNotional,
                        status: determineArbitrageStatus(arbitrage),
                        avgBuyPrice,
                        avgSellPrice,
                        matchedQty,
                        priceSpread,
                        realizedProfit,
                        symbolLegs,
                        makerParticipation: arbitrage.makerParticipationCount
                            ? arbitrage.makerParticipationSum / arbitrage.makerParticipationCount
                            : null,
                        makerOrderRatio: arbitrage.participationNotional
                            ? arbitrage.makerNotional / arbitrage.participationNotional
                            : null
                    };
                })
                .sort((a, b) => b.end - a.end);
            const symbolStats = Array.from(task.symbolMap.values())
                .map(symbol => {
                    const avgBuyPrice = symbol.buyQty ? symbol.buyNotional / symbol.buyQty : 0;
                    const avgSellPrice = symbol.sellQty ? symbol.sellNotional / symbol.sellQty : 0;
                    const {matchedQty, priceSpread, realizedProfit} = computeRealizedMetrics(
                        symbol.buyQty,
                        symbol.sellQty,
                        avgBuyPrice,
                        avgSellPrice
                    );
                    return {
                        ...symbol,
                        avgBuyPrice,
                        avgSellPrice,
                        profit: symbol.sellNotional - symbol.buyNotional,
                        priceSpread,
                        matchedQty,
                        realizedProfit,
                        openQty: symbol.buyQty - symbol.sellQty,
                        openNotional: symbol.buyNotional - symbol.sellNotional,
                        totalFee: symbol.fee,
                        makerFeeTotal: symbol.makerFee,
                        takerFeeTotal: symbol.takerFee,
                        makerParticipation: symbol.makerParticipationCount
                            ? symbol.makerParticipationSum / symbol.makerParticipationCount
                            : null,
                        makerOrderRatio: symbol.participationNotional
                            ? symbol.makerNotional / symbol.participationNotional
                            : null,
                        lastPrice: Number.isFinite(symbol.lastPrice) ? symbol.lastPrice : null
                    };
                })
                .sort((a, b) => a.symbol.localeCompare(b.symbol));
            const totalRealizedProfit = symbolStats.reduce((sum, item) => sum + item.realizedProfit, 0);
            const completedCount = arbitrages.filter(item => item.status === '已完成').length;
            const openCount = arbitrages.length - completedCount;
            const netExposureQty = symbolStats.reduce((sum, item) => sum + item.openQty, 0);
            const netExposureNotional = symbolStats.reduce((sum, item) => sum + item.openNotional, 0);
            const latestTrade = arbitrages.length ? arbitrages[0].end : (Number.isFinite(task.end) ? task.end : NaN);
            return {
                taskId: task.taskId,
                symbols: Array.from(task.symbolSet).sort(),
                arbitrages,
                arbitrageCount: arbitrages.length,
                completedCount,
                openCount,
                totalOrders: task.totalOrders,
                buyCount: task.buyCount,
                sellCount: task.sellCount,
                buyNotional: task.buyNotional,
                sellNotional: task.sellNotional,
                profit: task.sellNotional - task.buyNotional,
                realizedProfit: totalRealizedProfit,
                netExposureQty,
                netExposureNotional,
                symbolStats,
                latestTrade,
                totalFee: task.totalFee,
                makerFee: task.makerFee,
                takerFee: task.takerFee,
                makerParticipation: task.makerParticipationCount
                    ? task.makerParticipationSum / task.makerParticipationCount
                    : null,
                makerOrderRatio: task.participationNotional
                    ? task.makerNotional / task.participationNotional
                    : null,
                makerParticipationSum: task.makerParticipationSum,
                makerParticipationCount: task.makerParticipationCount,
                makerNotional: task.makerNotional,
                participationNotional: task.participationNotional,
                start: Number.isFinite(task.start) ? task.start : NaN,
                end: Number.isFinite(task.end) ? task.end : NaN
            };
        })
        .sort((a, b) => b.end - a.end);
}

function createEmptyTaskStats(gridTask) {
    const symbols = [];
    if (gridTask?.baseAsset) {
        symbols.push(String(gridTask.baseAsset));
    }
    if (gridTask?.quoteAsset) {
        symbols.push(String(gridTask.quoteAsset));
    }
    return {
        taskId: gridTask?.id ?? '未命名任务',
        symbols,
        arbitrages: [],
        arbitrageCount: 0,
        completedCount: 0,
        openCount: 0,
        totalOrders: 0,
        buyCount: 0,
        sellCount: 0,
        buyNotional: 0,
        sellNotional: 0,
        profit: 0,
        realizedProfit: 0,
        netExposureQty: 0,
        netExposureNotional: 0,
        symbolStats: [],
        latestTrade: NaN,
        totalFee: 0,
        makerFee: 0,
        takerFee: 0,
        makerParticipation: null,
        makerOrderRatio: null,
        makerParticipationSum: 0,
        makerParticipationCount: 0,
        makerNotional: 0,
        participationNotional: 0,
        start: NaN,
        end: NaN,
        averageCrossRate: null,
        averageBuyRate: null,
        averageSellRate: null,
        gridTask,
        hasOrders: false
    };
}

function createPlaceholderSymbolStats(symbol) {
    return {
        symbol,
        orderCount: 0,
        buyQty: 0,
        sellQty: 0,
        buyNotional: 0,
        sellNotional: 0,
        avgBuyPrice: 0,
        avgSellPrice: 0,
        profit: 0,
        priceSpread: 0,
        matchedQty: 0,
        realizedProfit: 0,
        openQty: 0,
        openNotional: 0,
        totalFee: 0,
        makerFeeTotal: 0,
        takerFeeTotal: 0,
        makerParticipation: null,
        makerOrderRatio: null,
        lastUpdate: NaN,
        lastPrice: null
    };
}

function composeAssetStats(symbolStats, gridTask) {
    const statsArray = Array.isArray(symbolStats) ? symbolStats : [];
    const statsMap = new Map(statsArray.map(stat => [stat.symbol, stat]));
    const desiredOrder = [];
    if (gridTask?.baseAsset) {
        desiredOrder.push(String(gridTask.baseAsset));
    }
    if (gridTask?.quoteAsset && gridTask.quoteAsset !== gridTask.baseAsset) {
        desiredOrder.push(String(gridTask.quoteAsset));
    }
    const seen = new Set();
    const ordered = [];
    desiredOrder.forEach(symbol => {
        if (!symbol || seen.has(symbol)) {
            return;
        }
        const stats = statsMap.get(symbol);
        ordered.push(stats ? {...stats} : createPlaceholderSymbolStats(symbol));
        seen.add(symbol);
    });
    statsArray.forEach(stat => {
        if (seen.has(stat.symbol)) {
            return;
        }
        ordered.push({...stat});
        seen.add(stat.symbol);
    });
    return ordered;
}

function findLegBySymbol(legs, symbol) {
    if (!symbol || !Array.isArray(legs)) {
        return null;
    }
    const normalized = String(symbol).toUpperCase();
    return legs.find(leg => String(leg.symbol).toUpperCase() === normalized) || null;
}

function enhanceArbitrageWithGrid(arbitrage, gridTask) {
    const legs = Array.isArray(arbitrage.symbolLegs) ? arbitrage.symbolLegs : [];
    const baseSymbol = gridTask?.baseAsset || gridTask?.baseAssert || null;
    const quoteSymbol = gridTask?.quoteAsset || gridTask?.quoteAssert || null;
    let baseLeg = baseSymbol ? findLegBySymbol(legs, baseSymbol) : null;
    let quoteLeg = quoteSymbol ? findLegBySymbol(legs, quoteSymbol) : null;
    if (!baseLeg && legs.length) {
        baseLeg = legs[0];
    }
    if ((!quoteLeg && legs.length > 1) || (quoteLeg && baseLeg && quoteLeg === baseLeg && legs.length > 1)) {
        quoteLeg = legs.find(leg => leg !== baseLeg) || quoteLeg;
    }
    const baseAvgPrice = baseLeg && Number.isFinite(baseLeg.avgPrice) && baseLeg.avgPrice > 0
        ? baseLeg.avgPrice
        : null;
    const quoteAvgPrice = quoteLeg && Number.isFinite(quoteLeg.avgPrice) && quoteLeg.avgPrice > 0
        ? quoteLeg.avgPrice
        : null;
    let averageCrossRate = null;
    let averageBuyRate = null;
    let averageSellRate = null;
    if (baseAvgPrice && quoteAvgPrice) {
        const rate = baseAvgPrice / quoteAvgPrice;
        averageCrossRate = rate;
        if (baseLeg?.side === 'BUY' && quoteLeg?.side === 'SELL') {
            averageBuyRate = rate;
        } else if (baseLeg?.side === 'SELL' && quoteLeg?.side === 'BUY') {
            averageSellRate = rate;
        }
    }
    return {
        ...arbitrage,
        symbolLegs: legs,
        baseLeg,
        quoteLeg,
        averageCrossRate,
        averageBuyRate,
        averageSellRate
    };
}

function mergeGridTasksWithStats(gridTasks, taskStats, initialExposure = new Map()) {
    const statsById = new Map(taskStats.map(task => [task.taskId, task]));
    const used = new Set();
    const merged = gridTasks.map((gridTask, index) => {
        const stats = statsById.get(gridTask.id);
        if (stats) {
            used.add(gridTask.id);
            return {
                ...stats,
                gridTask,
                hasOrders: stats.totalOrders > 0,
                gridIndex: index
            };
        }
        return {
            ...createEmptyTaskStats(gridTask),
            gridIndex: index
        };
    });

    const leftovers = taskStats
        .filter(task => !used.has(task.taskId))
        .map(task => ({
            ...task,
            gridTask: null,
            hasOrders: task.totalOrders > 0,
            gridIndex: Number.POSITIVE_INFINITY
        }))
        .sort((a, b) => {
            const aTime = Number.isFinite(a.end) ? a.end : Number.isFinite(a.latestTrade) ? a.latestTrade : 0;
            const bTime = Number.isFinite(b.end) ? b.end : Number.isFinite(b.latestTrade) ? b.latestTrade : 0;
            if (bTime !== aTime) {
                return bTime - aTime;
            }
            return a.taskId.localeCompare(b.taskId);
        });

    return [...merged, ...leftovers].map(item => {
        const {gridIndex, ...rest} = item;
        const assetStats = composeAssetStats(rest.symbolStats, rest.gridTask);
        const taskKey = rest.taskId ? String(rest.taskId) : null;
        const exposureForTask = taskKey && initialExposure instanceof Map ? initialExposure.get(taskKey) : null;
        const enhancedAssetStats = assetStats.map(asset => {
            const symbolKey = asset?.symbol ? String(asset.symbol).toUpperCase() : null;
            const symbolExposure = symbolKey && exposureForTask instanceof Map ? exposureForTask.get(symbolKey) : null;
            const initialQty = symbolExposure && Number.isFinite(symbolExposure.qty) ? symbolExposure.qty : 0;
            const initialNotional = symbolExposure && Number.isFinite(symbolExposure.notional) ? symbolExposure.notional : 0;
            const baseBuyQty = Number.isFinite(asset.buyQty) ? asset.buyQty : 0;
            const baseBuyNotional = Number.isFinite(asset.buyNotional) ? asset.buyNotional : 0;
            const baseSellQty = Number.isFinite(asset.sellQty) ? asset.sellQty : 0;
            const baseSellNotional = Number.isFinite(asset.sellNotional) ? asset.sellNotional : 0;
            let adjustedBuyQty = baseBuyQty;
            let adjustedBuyNotional = baseBuyNotional;
            let adjustedSellQty = baseSellQty;
            let adjustedSellNotional = baseSellNotional;
            if (initialQty > 0) {
                adjustedBuyQty += initialQty;
                adjustedBuyNotional += initialNotional;
            } else if (initialQty < 0) {
                const sellQtyAdjust = Math.abs(initialQty);
                const sellNotionalAdjust = Math.abs(initialNotional);
                adjustedSellQty += sellQtyAdjust;
                adjustedSellNotional += sellNotionalAdjust;
            }
            const avgBuyPrice = adjustedBuyQty ? adjustedBuyNotional / adjustedBuyQty : 0;
            const avgSellPrice = adjustedSellQty ? adjustedSellNotional / adjustedSellQty : 0;
            const {matchedQty, priceSpread, realizedProfit} = computeRealizedMetrics(
                adjustedBuyQty,
                adjustedSellQty,
                avgBuyPrice,
                avgSellPrice
            );
            const adjustedProfit = adjustedSellNotional - adjustedBuyNotional;
            const adjustedOpenQty = adjustedBuyQty - adjustedSellQty;
            const adjustedOpenNotional = adjustedBuyNotional - adjustedSellNotional;
            return {
                ...asset,
                initialExposureQty: initialQty,
                initialExposureNotional: initialNotional,
                buyQty: adjustedBuyQty,
                buyNotional: adjustedBuyNotional,
                sellQty: adjustedSellQty,
                sellNotional: adjustedSellNotional,
                avgBuyPrice,
                avgSellPrice,
                matchedQty,
                priceSpread,
                realizedProfit,
                profit: adjustedProfit,
                openQty: adjustedOpenQty,
                openNotional: adjustedOpenNotional,
                nominalOpenQty: adjustedOpenQty,
                nominalOpenNotional: adjustedOpenNotional
            };
        });
        const arbitrages = Array.isArray(rest.arbitrages)
            ? rest.arbitrages.map(arbitrage => enhanceArbitrageWithGrid(arbitrage, rest.gridTask))
            : [];
        let crossWeightedTotal = 0;
        let crossWeight = 0;
        let buyWeightedTotal = 0;
        let buyWeight = 0;
        let sellWeightedTotal = 0;
        let sellWeight = 0;
        arbitrages.forEach(arbitrage => {
            if (Number.isFinite(arbitrage.averageCrossRate) && Number.isFinite(arbitrage.matchedQty) && arbitrage.matchedQty > 0) {
                crossWeightedTotal += arbitrage.averageCrossRate * arbitrage.matchedQty;
                crossWeight += arbitrage.matchedQty;
            }
            if (Number.isFinite(arbitrage.averageBuyRate) && Number.isFinite(arbitrage.buyQty) && arbitrage.buyQty > 0) {
                buyWeightedTotal += arbitrage.averageBuyRate * arbitrage.buyQty;
                buyWeight += arbitrage.buyQty;
            }
            if (Number.isFinite(arbitrage.averageSellRate) && Number.isFinite(arbitrage.sellQty) && arbitrage.sellQty > 0) {
                sellWeightedTotal += arbitrage.averageSellRate * arbitrage.sellQty;
                sellWeight += arbitrage.sellQty;
            }
        });
        const averageCrossRate = crossWeight ? crossWeightedTotal / crossWeight : null;
        const averageBuyRate = buyWeight ? buyWeightedTotal / buyWeight : null;
        const averageSellRate = sellWeight ? sellWeightedTotal / sellWeight : null;
        const aggregatedPosition = enhancedAssetStats.reduce((acc, asset) => {
            const buyQty = Number.isFinite(asset.buyQty) ? asset.buyQty : 0;
            const sellQty = Number.isFinite(asset.sellQty) ? asset.sellQty : 0;
            const buyNotional = Number.isFinite(asset.buyNotional) ? asset.buyNotional : 0;
            const sellNotional = Number.isFinite(asset.sellNotional) ? asset.sellNotional : 0;
            const realizedProfit = Number.isFinite(asset.realizedProfit) ? asset.realizedProfit : 0;
            const openQty = Number.isFinite(asset.openQty) ? asset.openQty : 0;
            const openNotional = Number.isFinite(asset.openNotional) ? asset.openNotional : 0;
            acc.buyQty += buyQty;
            acc.sellQty += sellQty;
            acc.buyNotional += buyNotional;
            acc.sellNotional += sellNotional;
            acc.realizedProfit += realizedProfit;
            acc.netExposureQty += openQty;
            acc.netExposureNotional += openNotional;
            return acc;
        }, {
            buyQty: 0,
            sellQty: 0,
            buyNotional: 0,
            sellNotional: 0,
            realizedProfit: 0,
            netExposureQty: 0,
            netExposureNotional: 0
        });
        const aggregatedProfit = aggregatedPosition.sellNotional - aggregatedPosition.buyNotional;
        return {
            ...rest,
            assetStats: enhancedAssetStats,
            arbitrages,
            averageCrossRate,
            averageBuyRate,
            averageSellRate,
            buyNotional: aggregatedPosition.buyNotional,
            sellNotional: aggregatedPosition.sellNotional,
            profit: aggregatedProfit,
            realizedProfit: aggregatedPosition.realizedProfit,
            netExposureQty: aggregatedPosition.netExposureQty,
            netExposureNotional: aggregatedPosition.netExposureNotional
        };
    });
}

function parseRuntimeTimestampValue(value) {
    if (value === undefined || value === null) {
        return null;
    }
    if (typeof value === 'number') {
        if (!Number.isFinite(value) || value <= 0) {
            return null;
        }
        if (value > 1e12) {
            return value;
        }
        if (value > 1e9) {
            return value * 1000;
        }
        return null;
    }
    if (typeof value === 'string') {
        const trimmed = value.trim();
        if (!trimmed) {
            return null;
        }
        const numeric = Number(trimmed);
        if (Number.isFinite(numeric)) {
            return parseRuntimeTimestampValue(numeric);
        }
        const normalized = trimmed.includes('T') ? trimmed : trimmed.replace(' ', 'T');
        const parsed = Date.parse(normalized);
        return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
}

function gatherTimestampsFrom(source, explicitKeys = []) {
    if (!source || typeof source !== 'object') {
        return [];
    }
    const timestamps = [];
    const candidateKeys = new Set(explicitKeys);
    Object.keys(source).forEach(key => {
        if (/(At|Time|Timestamp|Ts)$/i.test(key)) {
            candidateKeys.add(key);
        }
    });
    candidateKeys.forEach(key => {
        if (!Object.prototype.hasOwnProperty.call(source, key)) {
            return;
        }
        const parsed = parseRuntimeTimestampValue(source[key]);
        if (parsed !== null) {
            timestamps.push(parsed);
        }
    });
    return timestamps;
}

function extractTaskActivityTimestamp(task) {
    if (!task || typeof task !== 'object') {
        return null;
    }
    const timestamps = [];
    const endTime = parseRuntimeTimestampValue(task.end);
    if (endTime !== null) {
        timestamps.push(endTime);
    }
    const latestTrade = parseRuntimeTimestampValue(task.latestTrade);
    if (latestTrade !== null) {
        timestamps.push(latestTrade);
    }
    timestamps.push(...gatherTimestampsFrom(task.gridTask, [
        'updatedAt',
        'lastUpdatedAt',
        'lastRunAt',
        'lastRuntimeAt',
        'runtimeAt',
        'runAt'
    ]));
    timestamps.push(...gatherTimestampsFrom(task.gridTask?.runtime, [
        'updatedAt',
        'updateTime',
        'lastUpdated',
        'lastUpdate',
        'lastRunAt',
        'lastRuntimeAt',
        'runtimeAt',
        'runAt',
        'timestamp'
    ]));
    if (!timestamps.length) {
        return null;
    }
    return Math.max(...timestamps);
}

function determineDefaultTaskId(tasks) {
    if (!Array.isArray(tasks) || !tasks.length) {
        return null;
    }

    let bestTaskId = null;
    let bestTimestamp = Number.NEGATIVE_INFINITY;

    tasks.forEach(task => {
        const activityTimestamp = extractTaskActivityTimestamp(task);
        if (activityTimestamp !== null && activityTimestamp > bestTimestamp) {
            bestTimestamp = activityTimestamp;
            bestTaskId = task.taskId;
        }
    });

    if (bestTaskId) {
        return bestTaskId;
    }

    const withOrders = tasks.filter(task => task.totalOrders > 0);
    return (withOrders[0] || tasks[0]).taskId;
}

function getTaskById(taskId) {
    if (!taskId) {
        return null;
    }
    return dashboardState.tasks.find(task => task.taskId === taskId) || null;
}

function getOrdersByTaskId(taskId) {
    if (!taskId) {
        return [];
    }
    return dashboardState.orders.filter(order => order.taskId === taskId);
}

function populateTaskSelector(tasks, selectedTaskId) {
    const selector = document.getElementById('grid-task-selector');
    if (!selector) {
        return;
    }

    selector.innerHTML = '';

    if (!Array.isArray(tasks) || !tasks.length) {
        selector.disabled = true;
        const option = document.createElement('option');
        option.value = '';
        option.textContent = '暂无网格任务';
        selector.appendChild(option);
        selector.value = '';
        return;
    }

    selector.disabled = false;
    tasks.forEach(task => {
        const option = document.createElement('option');
        option.value = task.taskId;
        const pairText = task.gridTask
            ? [task.gridTask.baseAsset, task.gridTask.quoteAsset].filter(Boolean).join('/')
            : (task.symbols && task.symbols.length ? task.symbols.join('/') : '');
        option.textContent = pairText ? `${task.taskId} · ${pairText}` : task.taskId;
        selector.appendChild(option);
    });

    const fallbackId = determineDefaultTaskId(tasks);
    const targetValue = tasks.some(task => task.taskId === selectedTaskId)
        ? selectedTaskId
        : fallbackId;
    selector.value = targetValue || '';
}

function renderSelectedTaskOverview(task) {
    const container = document.getElementById('selected-task-overview');
    const emptyHint = document.getElementById('grid-task-empty');
    if (!container || !emptyHint) {
        return;
    }

    container.innerHTML = '';

    if (!task) {
        emptyHint.hidden = false;
        return;
    }

    emptyHint.hidden = true;
    const assetStats = Array.isArray(task.assetStats) ? task.assetStats : [];
    const hasRealized = Number.isFinite(task.realizedProfit);
    const hasFee = Number.isFinite(task.totalFee);
    const netProfit = hasRealized && hasFee ? task.realizedProfit - task.totalFee : null;
    const metrics = [
        {
            key: fieldKey('overview', task.taskId, 'realized-profit'),
            label: '累计已套利利润',
            value: task.realizedProfit,
            decimals: 4,
            isProfit: true
        },
        {
            key: fieldKey('overview', task.taskId, 'total-fee'),
            label: '累计手续费',
            value: task.totalFee,
            decimals: FEE_DECIMALS
        },
        {
            key: fieldKey('overview', task.taskId, 'net-profit'),
            label: '净利润（扣手续费）',
            value: netProfit,
            decimals: 4,
            isProfit: true
        },
        {
            key: fieldKey('overview', task.taskId, 'net-exposure-notional'),
            label: '未平仓名义（双边仓位差值）',
            value: task.netExposureNotional,
            decimals: 4,
            isProfit: true
        },
        {
            key: fieldKey('overview', task.taskId, 'average-buy-rate'),
            label: '平均买入汇率',
            value: task.averageBuyRate,
            decimals: PRICE_PRECISION,
            formatter: formatPrice
        },
        {
            key: fieldKey('overview', task.taskId, 'average-sell-rate'),
            label: '平均卖出汇率',
            value: task.averageSellRate,
            decimals: PRICE_PRECISION,
            formatter: formatPrice
        },
        {
            key: fieldKey('overview', task.taskId, 'maker-order-ratio'),
            label: 'Maker成交额占比',
            value: task.makerOrderRatio,
            decimals: 4,
            isPercent: true
        },
        {
            key: fieldKey('overview', task.taskId, 'maker-participation'),
            label: '平均Maker参与度',
            value: task.makerParticipation,
            decimals: 4,
            isPercent: true
        },
        {
            key: fieldKey('overview', task.taskId, 'arbitrage-count'),
            label: '套利次数',
            value: task.arbitrageCount,
            decimals: 0
        }
    ];

    const gridTask = task.gridTask || null;
    const pairText = gridTask
        ? [gridTask.baseAsset, gridTask.quoteAsset].filter(Boolean).join(' / ')
        : (task.symbols && task.symbols.length ? task.symbols.join(' / ') : '-');
    const statusLabel = gridTask ? formatGridStatus(gridTask.status) : '未知';
    const gridInfoParts = [];
    if (gridTask && Number.isFinite(gridTask.gridRate)) {
        gridInfoParts.push(`网格间距 ${formatPercent(gridTask.gridRate, 4)}`);
    }
    if (gridTask && Number.isFinite(gridTask.gridValue)) {
        gridInfoParts.push(`单格金额 ${formatNumber(gridTask.gridValue, 4)}$`);
    }
    const timeRange = `时间范围：${formatDate(task.start)} ~ ${formatDate(task.end)}`;

    container.innerHTML = `
        <div class="asset-overview">
            <div class="asset-overview-header">
                <span>任务 <strong>${task.taskId}</strong></span>
                <span>币对 <strong>${pairText || '-'}</strong></span>
                <span>状态 <strong>${statusLabel}</strong></span>
                ${gridInfoParts.length ? `<span>${gridInfoParts.join(' · ')}</span>` : ''}
            </div>
            <div class="asset-metrics-grid">
                ${metrics.map(renderOverviewMetric).join('')}
            </div>
            ${
        assetStats.length
            ? `<div class="asset-card-grid">${assetStats.map(renderAssetCard).join('')}</div>`
            : '<p class="placeholder">暂无资产成交记录</p>'
    }
            <div class="asset-overview-footer">${timeRange}</div>
        </div>
    `;
}

function renderOverviewMetric(metric) {
    const label = metric.label || '-';
    const value = metric.value;
    const decimals = typeof metric.decimals === 'number' ? metric.decimals : DEFAULT_DECIMALS;
    const isProfit = Boolean(metric.isProfit);
    const isPercent = Boolean(metric.isPercent);
    const key = metric.key || fieldKey('overview', label);
    const formatter = typeof metric.formatter === 'function' ? metric.formatter : null;
    let displayValue = '-';
    if (formatter) {
        displayValue = formatter(value, decimals);
    } else if (isPercent) {
        displayValue = Number.isFinite(value) ? formatPercent(value, decimals) : '-';
    } else if (Number.isFinite(value)) {
        displayValue = formatNumber(value, decimals);
    }
    let valueClass = 'asset-metric-value';
    if (isProfit && Number.isFinite(value)) {
        valueClass += ` ${getProfitClass(value)}`;
    }
    return `
        <div class="asset-metric" data-field-key="${key}">
            <span class="asset-metric-label">${label}</span>
            <span class="${valueClass}">${displayValue}</span>
        </div>
    `;
}

function renderAssetCard(asset) {
    const metrics = [
        {
            key: fieldKey('asset', asset.symbol, 'total-buy-qty'),
            label: '总买入量',
            value: asset.buyQty,
            decimals: 4
        },
        {
            key: fieldKey('asset', asset.symbol, 'total-buy-notional'),
            label: '总买入金额',
            value: asset.buyNotional,
            decimals: 4
        },
        {
            key: fieldKey('asset', asset.symbol, 'avg-buy-price'),
            label: '平均买入价',
            value: asset.avgBuyPrice,
            decimals: PRICE_PRECISION,
            formatter: formatPrice
        },
        {
            key: fieldKey('asset', asset.symbol, 'total-sell-qty'),
            label: '总卖出量',
            value: asset.sellQty,
            decimals: 4
        },
        {
            key: fieldKey('asset', asset.symbol, 'total-sell-notional'),
            label: '总卖出金额',
            value: asset.sellNotional,
            decimals: 4
        },
        {
            key: fieldKey('asset', asset.symbol, 'avg-sell-price'),
            label: '平均卖出价',
            value: asset.avgSellPrice,
            decimals: PRICE_PRECISION,
            formatter: formatPrice
        },
        {
            key: fieldKey('asset', asset.symbol, 'price-spread'),
            label: '价差',
            value: asset.priceSpread,
            decimals: PRICE_PRECISION,
            formatter: formatPrice,
            isProfit: true
        },
        {
            key: fieldKey('asset', asset.symbol, 'matched-qty'),
            label: '已套利数量',
            value: asset.matchedQty,
            decimals: 4
        },
        {
            key: fieldKey('asset', asset.symbol, 'realized-profit'),
            label: '已套利利润',
            value: asset.realizedProfit,
            decimals: 4,
            isProfit: true
        },
        {
            key: fieldKey('asset', asset.symbol, 'total-fee'),
            label: '总手续费',
            value: asset.totalFee,
            decimals: FEE_DECIMALS
        },
        {
            key: fieldKey('asset', asset.symbol, 'open-qty'),
            label: '当前持仓数量',
            value: Number.isFinite(asset.nominalOpenQty) ? asset.nominalOpenQty : asset.openQty,
            decimals: 4,
            isProfit: true
        },
        {
            key: fieldKey('asset', asset.symbol, 'nominal-holding'),
            label: '当前名义持仓',
            value: computeNominalHolding(asset),
            decimals: 4,
            isProfit: true
        },
        {
            key: fieldKey('asset', asset.symbol, 'maker-order-ratio'),
            label: 'Maker成交额占比',
            value: asset.makerOrderRatio,
            decimals: 4,
            isPercent: true
        }
    ];
    const profitValue = Number.isFinite(asset.realizedProfit)
        ? formatNumber(asset.realizedProfit, 4)
        : '-';
    const profitClass = Number.isFinite(asset.realizedProfit)
        ? `asset-card-profit ${getProfitClass(asset.realizedProfit)}`
        : 'asset-card-profit profit-neutral';
    return `
        <div class="asset-card">
            <div class="asset-card-header">
                <span class="asset-card-title">${asset.symbol || '-'}</span>
                <span class="${profitClass}" data-field-key="${fieldKey('asset', asset.symbol, 'profit')}">${profitValue}</span>
            </div>
            <div class="asset-card-metrics">
                ${metrics.map(metric => renderAssetMetric(asset, metric)).join('')}
            </div>
            <div class="asset-card-footer" data-field-key="${fieldKey('asset', asset.symbol, 'last-update')}">最新成交：${formatDate(asset.lastUpdate)}</div>
        </div>
    `;
}

function renderAssetMetric(asset, metric) {
    const label = metric.label || '-';
    const value = metric.value;
    const decimals = typeof metric.decimals === 'number' ? metric.decimals : 2;
    const isProfit = Boolean(metric.isProfit);
    const isPercent = Boolean(metric.isPercent);
    const key = metric.key || fieldKey('asset-metric', asset?.symbol || '-', label);
    const formatter = typeof metric.formatter === 'function' ? metric.formatter : null;
    let displayValue = '-';
    if (formatter) {
        displayValue = formatter(value, decimals);
    } else if (isPercent) {
        displayValue = Number.isFinite(value) ? formatPercent(value, decimals) : '-';
    } else if (Number.isFinite(value)) {
        displayValue = formatNumber(value, decimals);
    }
    let valueClass = 'asset-card-metric-value';
    if (isProfit && Number.isFinite(value)) {
        valueClass += ` ${getProfitClass(value)}`;
    }
    return `
        <div class="asset-card-metric" data-field-key="${key}">
            <span class="asset-card-metric-label">${label}</span>
            <span class="${valueClass}">${displayValue}</span>
        </div>
    `;
}

function computeNominalHolding(asset) {
    const nominalQty = Number.isFinite(asset.nominalOpenQty)
        ? asset.nominalOpenQty
        : (Number.isFinite(asset.openQty) ? asset.openQty : null);
    const nominalNotional = Number.isFinite(asset.nominalOpenNotional)
        ? asset.nominalOpenNotional
        : (Number.isFinite(asset.openNotional) ? asset.openNotional : null);
    const lastPrice = Number.isFinite(asset.lastPrice) ? asset.lastPrice : null;
    if (nominalQty !== null && lastPrice !== null) {
        return nominalQty * lastPrice;
    }
    if (nominalNotional !== null) {
        return nominalNotional;
    }
    return NaN;
}

function renderDashboard() {
    const taskId = dashboardState.selectedTaskId;
    const selectedTask = getTaskById(taskId);
    const filteredOrders = getOrdersByTaskId(taskId);

    renderSelectedTaskOverview(selectedTask);
    renderTaskHierarchy(dashboardState.tasks, taskId);
    renderTimeline(filteredOrders);
    updateSectionIndicators(taskId);
}

const GRID_STATUS_LABELS = {
    RUNNING: '运行中',
    ACTIVE: '运行中',
    PAUSED: '已暂停',
    IDLE: '待启动',
    STOPPED: '已停止',
    FINISHED: '已结束',
    COMPLETED: '已结束',
    ERROR: '异常',
    FAILED: '异常',
    WAITING: '待启动',
    UNKNOWN: '未知'
};

function formatGridStatus(status) {
    if (!status) {
        return GRID_STATUS_LABELS.UNKNOWN;
    }
    const normalized = String(status).toUpperCase();
    return GRID_STATUS_LABELS[normalized] || normalized;
}

function getStatusClass(status) {
    if (!status) {
        return 'status-unknown';
    }
    const normalized = String(status).toUpperCase();
    if (normalized === 'RUNNING' || normalized === 'ACTIVE') {
        return 'status-running';
    }
    if (normalized === 'PAUSED' || normalized === 'WAITING' || normalized === 'IDLE') {
        return 'status-idle';
    }
    if (normalized === 'STOPPED') {
        return 'status-stopped';
    }
    if (normalized === 'FINISHED' || normalized === 'COMPLETED') {
        return 'status-finished';
    }
    if (normalized === 'ERROR' || normalized === 'FAILED') {
        return 'status-error';
    }
    return 'status-unknown';
}

function formatBoolean(value) {
    if (value === undefined || value === null) {
        return '-';
    }
    return value ? '是' : '否';
}

function formatValueWithUnit(value, unit = '', decimals = DEFAULT_DECIMALS) {
    if (!Number.isFinite(value)) {
        return '-';
    }
    const formatted = formatNumber(value, decimals);
    return unit ? `${formatted} ${unit}` : formatted;
}

function hasRuntimeData(runtime) {
    if (!runtime || typeof runtime !== 'object') {
        return false;
    }
    return ['baseQty', 'quoteQty', 'buyPrice', 'sellPrice', 'lastTradePrice'].some(key => Number.isFinite(runtime[key]));
}

function renderConfigItem(label, value, key) {
    const dataAttr = key ? ` data-field-key="${key}"` : '';
    return `
        <div class="grid-config-item"${dataAttr}>
            <span class="config-label">${label}</span>
            <span class="config-value">${value}</span>
        </div>
    `;
}

function formatInitPositionDisplay(quantity) {
    if (!Number.isFinite(quantity)) {
        return '未配置';
    }
    if (quantity > 0) {
        return `买入 ${formatNumber(quantity, 4)}`;
    }
    if (quantity < 0) {
        return `卖出 ${formatNumber(Math.abs(quantity), 4)}`;
    }
    return '未配置';
}

function createGridConfig(gridTask) {
    if (!gridTask) {
        return '';
    }
    const pair = [gridTask.baseAsset, gridTask.quoteAsset].filter(Boolean).join(' / ') || '-';
    const initPosition = gridTask.initPosition || null;
    const baseInitDisplay = formatInitPositionDisplay(initPosition?.baseQty);
    const quoteInitDisplay = formatInitPositionDisplay(initPosition?.quoteQty);
    const sections = [];
    sections.push(`
        <div class="grid-config-section">
            <div class="grid-config-title">任务参数</div>
            <div class="grid-config-grid">
                ${renderConfigItem('网格任务', gridTask.id, fieldKey('grid-task', gridTask.id, 'id'))}
                ${renderConfigItem('基础资产', gridTask.baseAsset || '-', fieldKey('grid-task', gridTask.id, 'base-asset'))}
                ${renderConfigItem('报价资产', gridTask.quoteAsset || '-', fieldKey('grid-task', gridTask.id, 'quote-asset'))}
                ${renderConfigItem('标的组合', pair, fieldKey('grid-task', gridTask.id, 'pair'))}
                ${renderConfigItem('起始价', formatPrice(gridTask.startPrice), fieldKey('grid-task', gridTask.id, 'start-price'))}
                ${renderConfigItem('网格间距', formatPercent(gridTask.gridRate, 4), fieldKey('grid-task', gridTask.id, 'grid-rate'))}
                ${renderConfigItem('单格金额', formatValueWithUnit(gridTask.gridValue, 'USDT', 4), fieldKey('grid-task', gridTask.id, 'grid-value'))}
                ${renderConfigItem('Base资产初始买入｜卖出数量', baseInitDisplay, fieldKey('grid-task', gridTask.id, 'init-position-base'))}
                ${renderConfigItem('Quote资产初始买入｜卖出数量', quoteInitDisplay, fieldKey('grid-task', gridTask.id, 'init-position-quote'))}
                ${renderConfigItem('双向执行', formatBoolean(gridTask.doubled), fieldKey('grid-task', gridTask.id, 'doubled'))}
                ${renderConfigItem('反向套利', formatBoolean(gridTask.reversed), fieldKey('grid-task', gridTask.id, 'reversed'))}
            </div>
        </div>
    `);

    if (hasRuntimeData(gridTask.runtime)) {
        const runtime = gridTask.runtime || {};
        sections.push(`
            <div class="grid-config-section">
                <div class="grid-config-title">运行状态</div>
                <div class="grid-config-grid">
                    ${renderConfigItem('base资产单格数量', formatNumber(runtime.baseQty, 4), fieldKey('grid-task', gridTask.id, 'runtime-baseqty'))}
                    ${renderConfigItem('quote资产单格数量', formatNumber(runtime.quoteQty, 4), fieldKey('grid-task', gridTask.id, 'runtime-quoteqty'))}
                    ${renderConfigItem('当前买入价', formatPrice(runtime.buyPrice), fieldKey('grid-task', gridTask.id, 'runtime-buy-price'))}
                    ${renderConfigItem('当前卖出价', formatPrice(runtime.sellPrice), fieldKey('grid-task', gridTask.id, 'runtime-sell-price'))}
                    ${renderConfigItem('最新成交价', formatPrice(runtime.lastTradePrice), fieldKey('grid-task', gridTask.id, 'runtime-last-trade-price'))}
                </div>
            </div>
        `);
    }

    return `<div class="grid-config">${sections.join('')}</div>`;
}

function updateSectionIndicators(taskId) {
    const text = taskId ? `当前任务：${taskId}` : '当前任务：-';
    const taskIndicator = document.getElementById('task-filter-indicator');
    const timelineIndicator = document.getElementById('timeline-filter-indicator');
    if (taskIndicator) {
        taskIndicator.textContent = text;
    }
    if (timelineIndicator) {
        timelineIndicator.textContent = text;
    }
}

function updateSelectedTaskId(taskId) {
    const tasks = dashboardState.tasks;
    if (!tasks.length) {
        dashboardState.selectedTaskId = null;
    } else {
        const exists = tasks.some(task => task.taskId === taskId);
        dashboardState.selectedTaskId = exists ? taskId : determineDefaultTaskId(tasks);
    }

    const selector = document.getElementById('grid-task-selector');
    if (selector) {
        const desiredValue = dashboardState.selectedTaskId || '';
        if (selector.value !== desiredValue) {
            selector.value = desiredValue;
        }
    }

    renderDashboard();
    applyFieldHighlights({skipAnimation: true});

    if (dashboardState.selectedTaskId) {
        requestAnimationFrame(() => {
            const target = document.querySelector(`details[data-task-id="${dashboardState.selectedTaskId}"]`);
            if (target) {
                target.open = true;
                target.scrollIntoView({behavior: 'smooth', block: 'start'});
            }
        });
    }
}

function renderTaskHierarchy(tasks, selectedTaskId) {
    const container = document.getElementById('task-hierarchy');
    const emptyHint = document.getElementById('task-empty');
    container.innerHTML = '';

    const existingTaskIds = new Set(tasks.map(task => task.taskId));
    const filtered = selectedTaskId ? tasks.filter(task => task.taskId === selectedTaskId) : tasks;

    if (!filtered.length) {
        emptyHint.hidden = false;
        return;
    }

    emptyHint.hidden = true;
    dashboardState.expandedTaskBlocks.forEach((_, taskId) => {
        if (!existingTaskIds.has(taskId)) {
            dashboardState.expandedTaskBlocks.delete(taskId);
            dashboardState.expandedArbitrages.delete(taskId);
        }
    });
    dashboardState.arbitragePage.forEach((_, taskId) => {
        if (!existingTaskIds.has(taskId)) {
            dashboardState.arbitragePage.delete(taskId);
        }
    });

    filtered.forEach((task, index) => {
        const details = document.createElement('details');
        details.className = 'task-block';
        details.dataset.taskId = task.taskId;
        const hasExpandedState = dashboardState.expandedTaskBlocks.has(task.taskId);
        const shouldOpenTask = hasExpandedState ? dashboardState.expandedTaskBlocks.get(task.taskId) : index === 0;
        details.open = Boolean(shouldOpenTask);
        dashboardState.expandedTaskBlocks.set(task.taskId, details.open);
        details.addEventListener('toggle', () => {
            dashboardState.expandedTaskBlocks.set(task.taskId, details.open);
        });

        const summary = document.createElement('summary');
        summary.innerHTML = createTaskSummary(task);
        details.appendChild(summary);

        const content = document.createElement('div');
        content.className = 'task-block-content';

        if (task.gridTask) {
            content.insertAdjacentHTML('beforeend', createGridConfig(task.gridTask));
        }

        if (task.arbitrages && task.arbitrages.length) {
            const table = document.createElement('table');
            table.className = 'arbitrage-table';
            table.innerHTML = `
                <thead>
                    <tr>
                        <th>批次ID</th>
                        <th>交易汇率</th>
                        <th>交易方向</th>
                        <th class="text-right">交易金额 (USDT)</th>
                        <th class="text-right">交易总手续费</th>
                        <th>批次状态</th>
                        <th>套利时间</th>
                    </tr>
                </thead>
            `;
            const tbody = document.createElement('tbody');
            const totalPages = Math.max(1, Math.ceil(task.arbitrages.length / ARBITRAGE_PAGE_SIZE));
            let currentPage = dashboardState.arbitragePage.get(task.taskId) || 1;
            if (currentPage > totalPages) {
                currentPage = totalPages;
            }
            if (currentPage < 1) {
                currentPage = 1;
            }
            dashboardState.arbitragePage.set(task.taskId, currentPage);
            const startIndex = (currentPage - 1) * ARBITRAGE_PAGE_SIZE;
            const arbitrageRows = task.arbitrages.slice(startIndex, startIndex + ARBITRAGE_PAGE_SIZE);
            const columnCount = table.querySelector('thead tr').children.length || 1;
            let expandedBindId = dashboardState.expandedArbitrages.get(task.taskId) ?? null;
            const hasArbState = Boolean(expandedBindId && arbitrageRows.some(item => item.taskBindId === expandedBindId));
            arbitrageRows.forEach((arbitrage, index) => {
                const summaryRow = document.createElement('tr');
                summaryRow.className = 'arbitrage-summary-row';
                summaryRow.innerHTML = createArbitrageSummaryCells(arbitrage, task);
                summaryRow.tabIndex = 0;
                summaryRow.setAttribute('role', 'button');
                const shouldOpenArbitrage = hasArbState ? expandedBindId === arbitrage.taskBindId : index === 0;
                summaryRow.setAttribute('aria-expanded', shouldOpenArbitrage ? 'true' : 'false');

                const detailRow = document.createElement('tr');
                detailRow.className = 'arbitrage-detail-row';
                detailRow.hidden = !shouldOpenArbitrage;
                const detailCell = document.createElement('td');
                detailCell.colSpan = columnCount;
                detailCell.innerHTML = createArbitrageDetail(arbitrage, task);
                detailRow.appendChild(detailCell);
                if (!hasArbState && shouldOpenArbitrage) {
                    dashboardState.expandedArbitrages.set(task.taskId, arbitrage.taskBindId);
                }

                summaryRow.addEventListener('click', () => {
                    toggleArbitrageDetail(task.taskId, arbitrage.taskBindId, summaryRow, detailRow, tbody);
                });
                summaryRow.addEventListener('keydown', event => {
                    if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        toggleArbitrageDetail(task.taskId, arbitrage.taskBindId, summaryRow, detailRow, tbody);
                    }
                });

                tbody.appendChild(summaryRow);
                tbody.appendChild(detailRow);
            });
            table.appendChild(tbody);
            content.appendChild(table);
            if (totalPages > 1) {
                const pager = document.createElement('div');
                pager.className = 'arbitrage-pagination';
                pager.innerHTML = `
                    <button type="button" class="arbitrage-page-btn prev" ${currentPage === 1 ? 'disabled' : ''}>上一页</button>
                    <span class="arbitrage-page-indicator">第 ${currentPage} / ${totalPages} 页</span>
                    <button type="button" class="arbitrage-page-btn next" ${currentPage === totalPages ? 'disabled' : ''}>下一页</button>
                `;
                const prevBtn = pager.querySelector('.arbitrage-page-btn.prev');
                const nextBtn = pager.querySelector('.arbitrage-page-btn.next');
                if (prevBtn) {
                    prevBtn.addEventListener('click', () => {
                        changeArbitragePage(task.taskId, -1);
                    });
                }
                if (nextBtn) {
                    nextBtn.addEventListener('click', () => {
                        changeArbitragePage(task.taskId, 1);
                    });
                }
                content.appendChild(pager);
            }
        } else {
            dashboardState.expandedArbitrages.delete(task.taskId);
            dashboardState.arbitragePage.delete(task.taskId);
            const placeholder = document.createElement('p');
            placeholder.className = 'placeholder';
            placeholder.textContent = task.hasOrders
                ? '暂无套利批次统计。'
                : '暂无成交记录，等待订单数据。';
            content.appendChild(placeholder);
        }
        details.appendChild(content);
        container.appendChild(details);
    });
}

function createTaskSummary(task) {
    const runtime = task.gridTask && task.gridTask.runtime ? task.gridTask.runtime : {};

    const symbolsText = task.symbols.length ? task.symbols.join('、') : '-';
    const arbitrageSummary = `${formatNumber(task.arbitrageCount, 0)}（完成 ${formatNumber(task.completedCount, 0)} / 未平 ${formatNumber(task.openCount, 0)}）`;
    const latestTradedPrice = formatPrice(runtime.lastTradePrice);
    const nextBidPrice = formatPrice(runtime.buyPrice);
    const nextAskPrice = formatPrice(runtime.sellPrice);

    const timeRange = (Number.isFinite(task.start) || Number.isFinite(task.end))
        ? `${formatDate(task.start)} ~ ${formatDate(task.end)}`
        : '暂无成交时间';
    const statusBadge = task.gridTask
        ? `<span class="status-badge ${getStatusClass(task.gridTask.status)}">${formatGridStatus(task.gridTask.status)}</span>`
        : `<span class="status-badge status-unknown">未登记</span>`;

    const gridInfoChips = [];
    if (task.gridTask) {
        if (Number.isFinite(task.gridTask.gridRate)) {
            gridInfoChips.push(`网格间距 ${formatPercent(task.gridTask.gridRate, 4)}`);
        }
        if (Number.isFinite(task.gridTask.gridValue)) {
            gridInfoChips.push(`单格金额 ${formatValueWithUnit(task.gridTask.gridValue, 'USDT', 4)}`);
        }
        if (Number.isFinite(task.gridTask.startPrice)) {
            gridInfoChips.push(`启动汇率 ${formatPrice(task.gridTask.startPrice)} (base ${task.gridTask.startBaseP} / quote ${task.gridTask.startQuoteP})`);
        }
    }
    if (Number.isFinite(runtime.baseQty) || Number.isFinite(runtime.quoteQty)) {
        const base = Number.isFinite(runtime.baseQty) ? formatNumber(runtime.baseQty, 4) : '-';
        const quote = Number.isFinite(runtime.quoteQty) ? formatNumber(runtime.quoteQty, 4) : '-';
        gridInfoChips.push(`单格数量 base ${base} / quote ${quote}`);
    }
    if (Number.isFinite(runtime.buyPrice)) {
        // gridInfoChips.push(`下一买入汇率 ${formatNumber(runtime.buyPrice, 4)}`);
    }
    if (Number.isFinite(runtime.sellPrice)) {
        // gridInfoChips.push(`下一卖出汇率 ${formatNumber(runtime.sellPrice, 4)}`);
    }
    if (Number.isFinite(runtime.lastTradePrice)) {
        // gridInfoChips.push(`最新成交汇率 ${formatNumber(runtime.lastTradePrice, 4)}`);
    }
    const chipHtml = gridInfoChips.map(chip => `<span class="task-chip">${chip}</span>`).join('');

    const latestTradeTime = formatDate(task.latestTrade);
    const summaryItems = [
        {label: '套利批次', value: arbitrageSummary},
        {label: '最新成交汇率', value: latestTradedPrice},
        {label: '下一买汇率', value: nextBidPrice},
        {label: '下一卖汇率', value: nextAskPrice},
        {label: '最新成交时间', value: latestTradeTime},
        {label: '时间范围', value: timeRange}
    ];
    const summaryHtml = summaryItems.map(item => `
        <div class="task-summary-card" data-field-key="${fieldKey('task-summary', task.taskId, item.label)}">
            <span class="task-summary-label">${item.label}</span>
            <span class="task-summary-value">${item.value}</span>
        </div>
    `).join('');

    return `
        <div class="task-header">
            <div class="task-info">
                <div class="task-title-row">
                    ${statusBadge}
                    <span class="task-title">${task.taskId}</span>
                </div>
                <div class="task-subtitle">币对：${symbolsText}</div>
                ${chipHtml ? `<div class="task-chip-group">${chipHtml}</div>` : ''}
            </div>
            <div class="task-summary-panel">
                ${summaryHtml}
            </div>
        </div>
    `;
}

function createArbitrageSummaryCells(arbitrage, task) {
    const totalFee = (Number.isFinite(arbitrage.baseLeg?.totalFee) ? arbitrage.baseLeg.totalFee : 0)
        + (Number.isFinite(arbitrage.quoteLeg?.totalFee) ? arbitrage.quoteLeg.totalFee : 0);
    const synthRate = Number.isFinite(arbitrage.synthPrice) ? formatPrice(arbitrage.synthPrice) : '-';
    const baseDirection = arbitrage.baseLeg?.side === 'BUY' ? '买入' : arbitrage.baseLeg?.side === 'SELL' ? '卖出' : '-';
    const baseAmountValue = Number.isFinite(arbitrage.baseLeg?.notional)
        ? formatNumber(arbitrage.baseLeg.notional, 4)
        : '-';
    const totalFeeText = Number.isFinite(totalFee) ? formatNumber(totalFee, FEE_DECIMALS) : '-';
    const statusText = arbitrage.status || '-';
    const baseTimeStart = Number.isFinite(arbitrage.baseLeg?.earliest) ? formatDate(arbitrage.baseLeg.earliest) : formatDate(arbitrage.start);
    const baseTimeEnd = Number.isFinite(arbitrage.baseLeg?.latest) ? formatDate(arbitrage.baseLeg.latest) : formatDate(arbitrage.end);
    const timeLabel = `${baseTimeStart}<br><small>${baseTimeEnd}</small>`;
    return `
        <td class="arbitrage-id-cell">${arbitrage.taskBindId}</td>
        <td>${synthRate}</td>
        <td>${baseDirection}</td>
        <td class="text-right">${baseAmountValue}</td>
        <td class="text-right">${totalFeeText}</td>
        <td>${statusText}</td>
        <td>${timeLabel}</td>
    `;
}

function createArbitrageDetail(arbitrage, task) {
    const baseLabel = task?.gridTask?.baseAsset || task?.gridTask?.baseAssert || arbitrage.baseLeg?.symbol || 'Base';
    const quoteLabel = task?.gridTask?.quoteAsset || task?.gridTask?.quoteAssert || arbitrage.quoteLeg?.symbol || 'Quote';
    const baseOrders = renderArbitrageOrderRows(arbitrage.baseLeg, 'Base');
    const quoteOrders = renderArbitrageOrderRows(arbitrage.quoteLeg, 'Quote');
    return `
        <div class="arbitrage-detail">
            <div class="arbitrage-detail-legs">
                <div class="arbitrage-orders-table-wrapper">
                    <table class="arbitrage-orders-table">
                        <thead>
                            <tr>
                                <th>角色</th>
                                <th>订单ID</th>
                                <th>方向</th>
                                <th>交易对</th>
                                <th class="text-right">成交数量</th>
                                <th class="text-right">成交价格</th>
                                <th class="text-right">成交金额</th>
                                <th class="text-right">手续费</th>
                                <th class="text-right">Maker占比</th>
                                <th class="text-right">订单状态</th>
                                <th>成交时间</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${baseOrders}
                            ${quoteOrders}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    `;
}

function translateOrderStatus(status) {
    switch (status) {
        case 'NEW':
            return '待成交';
        case 'FILLED':
            return '已成交';
        case 'CANCELED':
            return '已取消';
        default:
            return status || '-';
    }
}

function renderArbitrageOrderRows(leg, label) {
    if (!leg || !Array.isArray(leg.orders) || !leg.orders.length) {
        return `
            <tr>
                <td>${label}</td>
                <td colspan="10"><span class="placeholder">暂无订单</span></td>
            </tr>
        `;
    }
    const rows = leg.orders
        .slice()
        .sort((a, b) => a.updateTime - b.updateTime)
        .map(order => {
            const orderId = order.orderId || order.clientOrderId || '-';
            const maker = order.makerFeeRate
                || (Number.isFinite(order.makerParticipation) ? formatPercent(order.makerParticipation, 4) : '-');
            return `
                <tr>
                    <td>${label}</td>
                    <td>${orderId}</td>
                    <td>${order.side || '-'}</td>
                    <td>${order.symbol || '-'}</td>
                    <td class="text-right">${formatNumber(order.quantity, 4)}</td>
                    <td class="text-right">${formatPrice(order.price)}</td>
                    <td class="text-right">${formatNumber(order.notional, 4)}</td>
                    <td class="text-right">${formatNumber(order.txFee, FEE_DECIMALS)}</td>
                    <td class="text-right">${maker}</td>
                    <td class="text-right">${translateOrderStatus(order.status)}</td>
                    <td>${formatDate(order.updateTime)}</td>
                </tr>
            `;
        })
        .join('');
    return rows;
}

function renderLegSummaryLine(leg, label, symbolLabel) {
    if (!leg) {
        return '';
    }
    const direction = leg.side === 'BUY' ? '买入' : leg.side === 'SELL' ? '卖出' : '-';
    const quantity = Number.isFinite(leg.quantity) ? formatNumber(leg.quantity, 4) : '-';
    const avgPrice = Number.isFinite(leg.avgPrice) ? formatPrice(leg.avgPrice) : '-';
    const notional = Number.isFinite(leg.notional) ? formatNumber(leg.notional, 4) : '-';
    const fee = Number.isFinite(leg.totalFee) ? formatNumber(leg.totalFee, FEE_DECIMALS) : '-';
    const maker = Number.isFinite(leg.makerOrderRatio) ? formatPercent(leg.makerOrderRatio, 4) : '-';
    const symbol = symbolLabel || leg.symbol || label;
    return `
        <div class="rate-line">${label} ${symbol} · ${direction} 数量 ${quantity} · 均价 ${avgPrice} · 金额 ${notional} USDT · 手续费 ${fee} · Maker ${maker}</div>
    `;
}

function toggleArbitrageDetail(taskId, arbitrageId, summaryRow, detailRow, tbody) {
    const isHidden = detailRow.hidden;
    const summaryRows = Array.from(tbody.querySelectorAll('tr.arbitrage-summary-row'));
    const detailRows = Array.from(tbody.querySelectorAll('tr.arbitrage-detail-row'));
    let openedBindId = null;
    detailRows.forEach((row, index) => {
        const summary = summaryRows[index];
        if (row === detailRow) {
            const shouldOpen = isHidden;
            row.hidden = !shouldOpen;
            summary.setAttribute('aria-expanded', shouldOpen ? 'true' : 'false');
            if (shouldOpen) {
                openedBindId = arbitrageId;
            }
        } else {
            row.hidden = true;
            summary.setAttribute('aria-expanded', 'false');
        }
    });
    if (taskId) {
        if (openedBindId) {
            dashboardState.expandedArbitrages.set(taskId, openedBindId);
        } else {
            dashboardState.expandedArbitrages.set(taskId, null);
        }
    }
}

function changeArbitragePage(taskId, delta) {
    if (!taskId || typeof delta !== 'number') {
        return;
    }
    const task = dashboardState.tasks.find(item => item.taskId === taskId);
    if (!task || !Array.isArray(task.arbitrages) || !task.arbitrages.length) {
        return;
    }
    const totalPages = Math.max(1, Math.ceil(task.arbitrages.length / ARBITRAGE_PAGE_SIZE));
    const currentPage = dashboardState.arbitragePage.get(taskId) || 1;
    const nextPage = Math.min(Math.max(currentPage + delta, 1), totalPages);
    if (nextPage === currentPage) {
        return;
    }
    dashboardState.arbitragePage.set(taskId, nextPage);
    dashboardState.expandedArbitrages.delete(taskId);
    renderDashboard();
}

function renderArbitrageRates(arbitrage, baseLabel, quoteLabel) {
    const lines = [];
    if (Number.isFinite(arbitrage.averageBuyRate)) {
        lines.push(`买入 ${baseLabel}/${quoteLabel} ${formatPrice(arbitrage.averageBuyRate)}`);
    }
    if (Number.isFinite(arbitrage.averageSellRate)) {
        lines.push(`卖出 ${baseLabel}/${quoteLabel} ${formatPrice(arbitrage.averageSellRate)}`);
    }
    if (!lines.length && Number.isFinite(arbitrage.averageCrossRate)) {
        lines.push(`平均 ${baseLabel}/${quoteLabel} ${formatPrice(arbitrage.averageCrossRate)}`);
    }
    if (Number.isFinite(arbitrage.synthPrice)) {
        lines.push(`合成 ${formatPrice(arbitrage.synthPrice)}`);
    }
    if (!lines.length) {
        return '<span class="placeholder">-</span>';
    }
    return lines.map(line => `<div class="rate-line">${line}</div>`).join('');
}

function determineArbitrageStatus(arbitrage) {
    const buyOrders = Array.isArray(arbitrage.buyOrders) ? arbitrage.buyOrders : [];
    const sellOrders = Array.isArray(arbitrage.sellOrders) ? arbitrage.sellOrders : [];
    const allOrders = buyOrders.concat(sellOrders).filter(Boolean);
    if (allOrders.some(order => order.status === 'CANCELED')) {
        return '部分完成';
    }
    const buyFilled = buyOrders.some(order => order.status === 'FILLED');
    const sellFilled = sellOrders.some(order => order.status === 'FILLED');
    if (buyFilled && sellFilled) {
        return '已完成';
    }
    if (buyFilled) {
        return '待卖出';
    }
    if (sellFilled) {
        return '待买入';
    }
    return '待交易';
}

function getOrderKey(order) {
    if (!order || typeof order !== 'object') {
        return null;
    }
    const preferred = order.orderId || order.clientOrderId;
    if (preferred) {
        return String(preferred);
    }
    const parts = [
        order.taskBindId,
        order.symbol,
        order.side,
        Number.isFinite(order.updateTime) ? order.updateTime : '',
        Number.isFinite(order.price) ? order.price : '',
        Number.isFinite(order.quantity) ? order.quantity : ''
    ];
    const fallback = parts.filter(part => part !== undefined && part !== null && part !== '').join('|');
    return fallback || null;
}

function renderTimeline(orders) {
    const tbody = document.getElementById('timeline-table');
    const emptyHint = document.getElementById('timeline-empty');
    tbody.innerHTML = '';

    if (!orders.length) {
        emptyHint.hidden = false;
        return;
    }

    emptyHint.hidden = true;
    const rawNewKeys = dashboardState.lastNewOrderKeys instanceof Set
        ? new Set(dashboardState.lastNewOrderKeys)
        : new Set();
    orders.slice().reverse().slice(0, 10).forEach(order => {
        const orderIdDisplay = order.orderId || order.clientOrderId || '-';
        const tr = document.createElement('tr');
        const orderKey = getOrderKey(order);
        tr.innerHTML = `
            <td>${order.symbol}</td>
            <td>${orderIdDisplay}</td>
            <td><span class="badge ${order.side === 'BUY' ? 'badge-buy' : 'badge-sell'}">${order.side}</span></td>
            <td class="text-right">${formatNumber(order.quantity, 4)}</td>
            <td class="text-right">${formatPrice(order.price)}</td>
            <td class="text-right">${formatNumber(order.notional, 4)}</td>
            <td class="text-right">${formatNumber(order.txFee, FEE_DECIMALS)}</td>
            <td>${order.makerFeeRate || formatPercent(order.makerParticipation, 4)}</td>
            <td>${order.status || '-'}</td>
            <td>${formatDate(order.updateTime)}</td>
            <td>${order.taskBindId || '-'}</td>
        `;
        if (orderKey && rawNewKeys.has(orderKey)) {
            tr.classList.add('timeline-row-highlight');
            rawNewKeys.delete(orderKey);
            window.setTimeout(() => {
                tr.classList.remove('timeline-row-highlight');
            }, 1500);
        }
        tbody.appendChild(tr);
    });
    dashboardState.lastNewOrderKeys = rawNewKeys;
}

function formatPrice(value, precision = PRICE_PRECISION) {
    if (!Number.isFinite(value)) {
        return '-';
    }
    const safePrecision = Number.isFinite(precision) && precision > 0 ? precision : PRICE_PRECISION;
    const num = Number(value);
    const raw = num.toPrecision(safePrecision);
    if (raw.includes('e') || raw.includes('E')) {
        return raw;
    }
    const isNegative = raw.startsWith('-');
    const unsignedRaw = isNegative ? raw.slice(1) : raw;
    const [integerPartRaw, decimalPart] = unsignedRaw.split('.');
    const groupedInteger = Number(integerPartRaw).toLocaleString('en-US');
    const signedInteger = isNegative ? `-${groupedInteger}` : groupedInteger;
    return decimalPart !== undefined ? `${signedInteger}.${decimalPart}` : signedInteger;
}

function formatNumber(value, decimals = DEFAULT_DECIMALS) {
    if (!Number.isFinite(value)) {
        return '-';
    }
    const precision = Number.isFinite(decimals) ? decimals : DEFAULT_DECIMALS;
    return value.toLocaleString('en-US', {
        minimumFractionDigits: precision,
        maximumFractionDigits: precision
    });
}

function formatPercent(value, decimals = DEFAULT_DECIMALS) {
    if (!Number.isFinite(value)) {
        return '-';
    }
    return `${formatNumber(value * 100, decimals)}%`;
}

function formatDate(timestamp) {
    if (!Number.isFinite(timestamp) || timestamp <= 0) {
        return '-';
    }
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) {
        return '-';
    }
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    const hh = String(date.getHours()).padStart(2, '0');
    const min = String(date.getMinutes()).padStart(2, '0');
    const ss = String(date.getSeconds()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd} ${hh}:${min}:${ss}`;
}

function setSourceStatus(text) {
    const metaEl = document.getElementById('source-meta');
    if (metaEl) {
        metaEl.textContent = text;
    }
}

function updateMeta(text) {
    setSourceStatus(text);
    const lastRefreshEl = document.getElementById('last-refresh');
    if (lastRefreshEl) {
        lastRefreshEl.textContent = `最后更新：${formatDate(Date.now())}`;
    }
}

function resetError() {
    const errorEl = document.getElementById('error-message');
    if (errorEl) {
        errorEl.hidden = true;
        errorEl.textContent = '';
    }
}

function showError(message) {
    const errorEl = document.getElementById('error-message');
    if (errorEl) {
        errorEl.textContent = message;
        errorEl.hidden = false;
    }
}

function getProfitClass(value) {
    if (!Number.isFinite(value) || Math.abs(value) < 1e-12) {
        return 'profit-neutral';
    }
    return value > 0 ? 'profit-positive' : 'profit-negative';
}

function triggerFieldHighlight(element) {
    if (!element) {
        return;
    }
    element.classList.remove('data-field-highlight');
    void element.offsetWidth;
    element.classList.add('data-field-highlight');
    window.setTimeout(() => {
        element.classList.remove('data-field-highlight');
    }, 1200);
}

function applyFieldHighlights(options = {}) {
    const {skipAnimation = false} = options;
    const nextSnapshot = new Map();
    document.querySelectorAll('[data-field-key]').forEach(element => {
        const key = element.getAttribute('data-field-key');
        if (!key) {
            return;
        }
        const value = (element.textContent || '').replace(/\s+/g, ' ').trim();
        const previousValue = dashboardState.fieldSnapshot.get(key);
        nextSnapshot.set(key, value);
        if (previousValue !== undefined && previousValue !== value) {
            if (!skipAnimation) {
                triggerFieldHighlight(element);
            }
            handleFieldChange(key, previousValue, value, element);
        }
    });
    dashboardState.fieldSnapshot = nextSnapshot;
}

function normalizeKeySegment(part) {
    if (part === undefined || part === null) {
        return '';
    }
    const raw = String(part).trim();
    if (!raw) {
        return '';
    }
    const ascii = raw
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
    if (ascii) {
        return ascii;
    }
    let hash = 0;
    for (let i = 0; i < raw.length; i += 1) {
        hash = ((hash << 5) - hash) + raw.charCodeAt(i);
        hash |= 0;
    }
    return `h${Math.abs(hash)}`;
}

function fieldKey(...parts) {
    const normalized = parts
        .map(normalizeKeySegment)
        .filter(Boolean);
    return normalized.length ? normalized.join('__') : 'field';
}

function handleFieldChange(key, previousValue, nextValue, element) {
    if (!isRuntimeFieldKey(key)) {
        return;
    }
    const valueElement = element.querySelector('.config-value');
    const currentValueText = valueElement ? valueElement.textContent.trim() : nextValue;
    const previousNumeric = extractNumericValue(previousValue);
    const nextNumeric = extractNumericValue(currentValueText);
    const runtimeMatch = key.match(/runtime-(buy-price|sell-price|last-trade-price)$/);
    const runtimeField = runtimeMatch ? runtimeMatch[1] : null;
    const taskDetails = element.closest('[data-task-id]');
    const taskId = taskDetails ? taskDetails.dataset.taskId : null;
    document.dispatchEvent(new CustomEvent('grid-runtime-field-change', {
        detail: {
            key,
            taskId,
            field: runtimeField,
            previousText: previousValue,
            nextText: currentValueText,
            previousValue: previousNumeric,
            nextValue: nextNumeric,
            element
        }
    }));
}

function isRuntimeFieldKey(key) {
    if (typeof key !== 'string') {
        return false;
    }
    return /runtime-(buy-price|sell-price|last-trade-price)$/.test(key);
}

function extractNumericValue(text) {
    if (typeof text !== 'string') {
        return null;
    }
    const match = text.match(/-?\d+(?:\.\d+)?/g);
    if (!match || !match.length) {
        return null;
    }
    const parsed = Number(match[match.length - 1]);
    return Number.isFinite(parsed) ? parsed : null;
}

function startAutoRefresh() {
    stopAutoRefresh();
    dashboardState.refreshTimerId = window.setInterval(() => {
        refreshData({silent: true});
    }, 5000);
}

function stopAutoRefresh() {
    if (dashboardState.refreshTimerId !== null) {
        clearInterval(dashboardState.refreshTimerId);
        dashboardState.refreshTimerId = null;
    }
}

async function refreshData(options = {}) {
    const {initial = false, silent = false} = options;
    if (dashboardState.isRefreshing) {
        return;
    }
    dashboardState.isRefreshing = true;

    if (initial || !silent) {
        setSourceStatus('正在加载网格任务与订单数据...');
    }

    resetError();

    try {
        const [gridResult, orderResult] = await Promise.allSettled([
            loadGridTasks(),
            loadOrders()
        ]);

        let normalizedGridTasks = Array.isArray(dashboardState.gridTasks)
            ? [...dashboardState.gridTasks]
            : [];
        if (gridResult.status === 'fulfilled') {
            const rawTasks = Array.isArray(gridResult.value) ? gridResult.value : [];
            normalizedGridTasks = normalizeGridTasks(rawTasks);
        } else {
            const error = gridResult.reason instanceof Error ? gridResult.reason.message : '加载网格任务数据失败';
            showError(error);
            if (!dashboardState.gridTasks.length) {
                normalizedGridTasks = [];
            }
        }

        let normalizedOrders = Array.isArray(dashboardState.orders)
            ? [...dashboardState.orders]
            : [];
        if (orderResult.status === 'fulfilled') {
            const payload = orderResult.value || {};
            normalizedOrders = normalizeOrders(payload.orders || []);
            normalizedOrders.sort((a, b) => a.updateTime - b.updateTime);
        } else {
            const error = orderResult.reason instanceof Error ? orderResult.reason.message : '加载订单数据失败';
            showError(error);
            if (!dashboardState.orders.length) {
                normalizedOrders = [];
            }
        }

        const {filteredOrders, initialExposure} = partitionInitialOrders(normalizedOrders, normalizedGridTasks);

        const previousOrderKeys = dashboardState.orderKeySnapshot instanceof Set
            ? dashboardState.orderKeySnapshot
            : new Set();
        const nextOrderKeys = new Set();
        const newOrderKeys = new Set();
        filteredOrders.forEach(order => {
            const key = getOrderKey(order);
            if (!key) {
                return;
            }
            nextOrderKeys.add(key);
            if (previousOrderKeys.size > 0 && !previousOrderKeys.has(key)) {
                newOrderKeys.add(key);
            }
        });

        const taskHierarchy = buildTaskHierarchy(filteredOrders);
        const mergedTasks = mergeGridTasksWithStats(normalizedGridTasks, taskHierarchy, initialExposure);

        const previousSelectedTaskId = dashboardState.selectedTaskId;
        const hasPreviousTask = previousSelectedTaskId
            && mergedTasks.some(task => task.taskId === previousSelectedTaskId);

        dashboardState.orders = filteredOrders;
        dashboardState.tasks = mergedTasks;
        dashboardState.gridTasks = normalizedGridTasks;
        dashboardState.selectedTaskId = hasPreviousTask
            ? previousSelectedTaskId
            : determineDefaultTaskId(mergedTasks);
        dashboardState.orderKeySnapshot = nextOrderKeys;
        dashboardState.lastNewOrderKeys = newOrderKeys;

        populateTaskSelector(mergedTasks, dashboardState.selectedTaskId);
        renderDashboard();
        applyFieldHighlights({
            skipAnimation: initial && dashboardState.fieldSnapshot.size === 0
        });

        const gridMeta = `${normalizedGridTasks.length} 个网格任务（../grid/data/grid_tasks.json）`;
        const orderMeta = filteredOrders.length
            ? `${filteredOrders.length} 条订单（grid/data/orders-*.json）`
            : '暂无订单数据';
        updateMeta(`数据源：${gridMeta} · ${orderMeta}`);
    } catch (error) {
        showError(error instanceof Error ? error.message : String(error));
    } finally {
        dashboardState.isRefreshing = false;
    }
}

async function init() {
    await refreshData({initial: true, silent: false});
    startAutoRefresh();
}

init();
