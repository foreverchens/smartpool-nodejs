const cycleSelect = document.getElementById('cycle-select');
const stageSelect = document.getElementById('stage-select');
const container = document.getElementById('content');
const listsSection = document.getElementById('lists-section');
const initialListSpan = document.getElementById('symbol-list');
const pairListSpan = document.getElementById('pair-list');
const symbolListMeta = document.getElementById('symbol-list-meta');
const pairListMeta = document.getElementById('pair-list-meta');
const workspace = document.getElementById('workspace');
const stageSymbolListEl = document.getElementById('stage-symbol-list');
const summaryMetricsEl = document.getElementById('summary-metrics');
const chartFeedbackEl = document.getElementById('chart-feedback');
const detailsPanel = document.getElementById('details-panel');
const detailsJsonEl = document.getElementById('details-json');
const periodSelect = document.getElementById('period-select');
const baseInput = document.getElementById('base-input');
const quoteInput = document.getElementById('quote-input');
const symbolApplyBtn = document.getElementById('symbol-apply');
const qualityHintEl = document.getElementById('quality-hint');

const chart = echarts.init(document.getElementById('chart'));
const STAGE_OPTIONS = [
    // {label: '初始币对列表', value: 'initial-results', stage: 'rltArr'},
    // {label: '过滤后BTC币对币种', value: 'center-list', stage: 'centerList'},
    {label: '高位BTC币对列表', value: 'high-list', stage: 'highList'},
    {label: '低位BTC币对列表', value: 'low-list', stage: 'lowList'},
    {label: '双币量化币对列表', value: 'final-results', stage: 'data'}
];
const DEFAULT_STAGE = 'final-results';
const STAGE_META_BY_VALUE = STAGE_OPTIONS.reduce((acc, cur) => {
    acc[cur.value] = cur;
    return acc;
}, {});
const KNOWN_QUOTES = ['USDT', 'USDC', 'BTC', 'ETH', 'BUSD'];
const LINEAR_QUOTES = new Set(['USDT', 'USDC', 'BUSD']);
const PERIOD_INTERVAL_MS = {
    '1m': 60 * 1000,
    '5m': 5 * 60 * 1000,
    '15m': 15 * 60 * 1000,
    '30m': 30 * 60 * 1000,
    '1h': 60 * 60 * 1000,
    '4h': 4 * 60 * 60 * 1000
};

// 当前选中的量化周期
let currentCycleKey = '';
let currentStageValue = DEFAULT_STAGE;
let currentRows = [];
let symbolRowMap = new Map();
let activeSymbol = '';
let klineRequestId = 0;
let activeBoundaries = null;
const boundaryCache = new Map();
const QUALITY_HINT_TEXT = '评分等级：C (<10000)，B (<15000)，A (<20000)，S (<25000)，SSS (≥25000)';
if (qualityHintEl) {
    qualityHintEl.textContent = QUALITY_HINT_TEXT;
}
let cachedCycleMeta = null;

function buildCycleQuery(cycleKey) {
    if (!cycleKey) {
        return '';
    }
    return `?cycle=${encodeURIComponent(cycleKey)}`;
}

async function fetchCycleSummary(cycleKey) {
    const query = buildCycleQuery(cycleKey);
    return fetchJson(`/api/data${query}`);
}

function formatCycleOptionLabel(entry) {
    if (!entry || (entry.cycleKey === null && entry.cycleHours === null)) {
        return '未知周期';
    }
    const hours = Number(entry.cycleHours);
    const days = Number(entry.cycleDays);
    const hoursText = Number.isFinite(hours) ? `${hours} 小时` : null;
    const daysText = Number.isFinite(days) ? `${days} 天` : null;
    if (hoursText && daysText) {
        return `${daysText} (${hoursText})`;
    }
    if (daysText) {
        return daysText;
    }
    if (hoursText) {
        return hoursText;
    }
    if (entry.cycleKey) {
        return entry.cycleKey;
    }
    return '未知周期';
}

// 统一记录周期元信息，便于 UI 回显
function setCycleMeta(source) {
    if (!source) {
        return;
    }
    const hours = Number(source.cycleHours);
    const days = Number(source.cycleDays);
    const previousHours = cachedCycleMeta && Number.isFinite(cachedCycleMeta.cycleHours)
        ? cachedCycleMeta.cycleHours
        : undefined;
    const previousDays = cachedCycleMeta && Number.isFinite(cachedCycleMeta.cycleDays)
        ? cachedCycleMeta.cycleDays
        : undefined;
    const resolvedHours = Number.isFinite(hours) ? hours : previousHours;
    const resolvedDays = Number.isFinite(days)
        ? days
        : (Number.isFinite(resolvedHours)
            ? (Number.isFinite(previousDays) ? previousDays : resolvedHours / 24)
            : previousDays);
    cachedCycleMeta = {
        cycleHours: resolvedHours,
        cycleDays: resolvedDays
    };
}

function populateCycleSelect(summary) {
    if (!cycleSelect) {
        return '';
    }
    const cycles = Array.isArray(summary && summary.cycles) ? summary.cycles : [];
    if (!cycles.length) {
        cycleSelect.innerHTML = '<option value="">暂无周期</option>';
        cycleSelect.disabled = true;
        currentCycleKey = '';
        return '';
    }
    const optionsHtml = cycles.map(entry => {
        const key = entry.cycleKey || String(entry.cycleHours);
        const label = formatCycleOptionLabel(entry);
        return `<option value="${key}">${label}</option>`;
    });
    cycleSelect.innerHTML = optionsHtml.join('');
    cycleSelect.disabled = false;
    const selectedKey = (summary && summary.cycleKey)
        || (summary && summary.defaultCycleKey)
        || cycles[0].cycleKey
        || String(cycles[0].cycleHours);
    currentCycleKey = selectedKey || '';
    cycleSelect.value = currentCycleKey;
    return currentCycleKey;
}

function setStageMessage(text) {
    container.textContent = text;
    container.classList.remove('overview-grid');
    container.classList.add('stage-message');
}

function setStageSummary(html) {
    container.innerHTML = html;
    container.classList.remove('stage-message');
    container.classList.add('overview-grid');
}

function assignInputValues(base, quote) {
    baseInput.value = (base || '').toUpperCase();
    quoteInput.value = (quote || '').toUpperCase();
}

function parseSymbol(symbol) {
    if (!symbol) {
        return {base: '', quote: ''};
    }
    const upper = symbol.toUpperCase();
    if (upper.includes('-')) {
        const [base, quote] = upper.split('-');
        return {base, quote};
    }
    for (const quote of KNOWN_QUOTES) {
        if (upper.endsWith(quote) && upper.length > quote.length) {
            return {base: upper.slice(0, -quote.length), quote};
        }
    }
    return {base: upper, quote: ''};
}

function normalizeSymbol(base, quote) {
    const normalizedBase = (base || '').trim().toUpperCase();
    const normalizedQuote = (quote || '').trim().toUpperCase();
    if (!normalizedBase) {
        return '';
    }
    let resolvedQuote = normalizedQuote;
    if (!resolvedQuote) {
        resolvedQuote = 'USDT';
    }
    if (LINEAR_QUOTES.has(resolvedQuote)) {
        return normalizedBase + resolvedQuote;
    }
    return `${normalizedBase}-${resolvedQuote}`;
}

function deriveQuality(score) {
    const value = Number(score);
    if (!Number.isFinite(value)) {
        return {grade: '--', hint: '未评级'};
    }
    if (value < 10000) {
        return {grade: 'C', hint: '<10000'};
    }
    if (value < 15000) {
        return {grade: 'B', hint: '<15000'};
    }
    if (value < 20000) {
        return {grade: 'A', hint: '<20000'};
    }
    if (value < 25000) {
        return {grade: 'S', hint: '<25000'};
    }
    return {grade: 'SSS', hint: '≥25000'};
}

function getInputSymbol() {
    let base = baseInput.value.trim().toUpperCase();
    let quote = quoteInput.value.trim().toUpperCase();

    if (!base) {
        assignInputValues('', quote);
        return {base: '', quote, symbol: ''};
    }

    if (base.includes('-')) {
        const parsed = parseSymbol(base);
        if (parsed.base) {
            base = parsed.base;
            if (!quote) {
                quote = parsed.quote;
            }
        }
    }

    if (!quote) {
        const parsed = parseSymbol(base);
        if (parsed.base && parsed.quote) {
            base = parsed.base;
            quote = parsed.quote;
        } else {
            quote = 'USDT';
        }
    }

    if (quote && base.endsWith(quote) && base.length > quote.length) {
        base = base.slice(0, -quote.length);
    }

    assignInputValues(base, quote);
    const symbol = normalizeSymbol(base, quote);
    return {base, quote, symbol};
}

function extractBounds(row) {
    if (!row) {
        return null;
    }
    const lowVal = Number(row.lowP);
    const highVal = Number(row.highP);
    if (!Number.isFinite(lowVal) || !Number.isFinite(highVal)) {
        return null;
    }
    return {low: lowVal, high: highVal};
}

function formatDateTime(value) {
    if (!value) {
        return '未知';
    }
    const time = Date.parse(value);
    if (Number.isNaN(time)) {
        return value;
    }
    return new Date(time).toLocaleString();
}

function fetchJson(url) {
    return fetch(url)
        .then(async resp => {
            const data = await resp.json().catch(() => null);
            if (!resp.ok) {
                const message = data && data.error ? data.error : resp.statusText || '请求失败';
                throw new Error(message);
            }
            return data;
        });
}

function renderLinkList(containerEl, list, metaEl, savedAt) {
    containerEl.innerHTML = '';
    const finalList = Array.isArray(list)
        ? list.map(item => {
            if (typeof item === 'string') {
                return item.trim();
            }
            if (item && typeof item === 'object' && typeof item.symbol === 'string') {
                return item.symbol.trim();
            }
            return '';
        }).filter(Boolean)
        : [];
    if (!finalList.length) {
        containerEl.textContent = '无数据';
        if (metaEl) {
            metaEl.textContent = savedAt ? `(更新于 ${formatDateTime(savedAt)})` : '';
        }
        return;
    }
    finalList.forEach((symbol, index) => {
        const link = document.createElement('a');
        link.href = '#';
        link.textContent = symbol;
        link.addEventListener('click', event => {
            event.preventDefault();
            selectSymbolByName(symbol, true);
        });
        containerEl.appendChild(link);
        if (index < finalList.length - 1) {
            containerEl.appendChild(document.createTextNode(', '));
        }
    });
    if (!containerEl.hasChildNodes()) {
        containerEl.textContent = '无数据';
    }
    if (metaEl) {
        metaEl.textContent = savedAt ? `(更新于 ${formatDateTime(savedAt)})` : '';
    }
}

function formatSummaryValue(value) {
    if (value === null || value === undefined || value === '') {
        return '--';
    }
    const num = Number(value);
    if (!Number.isNaN(num)) {
        if (Math.abs(num) >= 100) {
            return num.toFixed(2);
        }
        if (Math.abs(num) >= 1) {
            return num.toFixed(3);
        }
        return num.toPrecision(3);
    }
    return String(value);
}

function updateSummary(row) {
    summaryMetricsEl.innerHTML = '';
    if (!row) {
        summaryMetricsEl.innerHTML = '<span class="muted">请选择币对</span>';
        return;
    }
    const summaryFields = [
        {key: 'symbol', label: '币对'},
        {key: 'score', label: 'Score'},
        {key: 'amp', label: '振幅'},
        {key: 'lowP', label: '低位'},
        {key: 'highP', label: '高位'},
        {key: 'pricePosit', label: '价格位置'},
        {key: 'volume', label: '成交量'},
        {key: 'change', label: '涨跌幅'}
    ];
    const qualityInfo = deriveQuality(row.score);
    let rendered = 0;
    summaryFields.forEach(field => {
        if (row[field.key] === undefined || row[field.key] === null || row[field.key] === '') {
            return;
        }
        rendered++;
        const wrapper = document.createElement('div');
        wrapper.className = 'summary-item';

        const labelEl = document.createElement('span');
        labelEl.className = 'summary-label';
        labelEl.textContent = field.label;

        const valueEl = document.createElement('span');
        valueEl.className = 'summary-value';
        valueEl.textContent = formatSummaryValue(row[field.key]);
        if (field.key === 'score' && qualityInfo && qualityInfo.hint) {
            valueEl.title = `评分：${qualityInfo.grade}，规则：${qualityInfo.hint}`;
        }

        wrapper.appendChild(labelEl);
        wrapper.appendChild(valueEl);
        summaryMetricsEl.appendChild(wrapper);
    });
    if (rendered === 0) {
        summaryMetricsEl.innerHTML = '<span class="muted">该阶段未提供指标字段</span>';
    }
    const bounds = extractBounds(row);
    if (bounds) {
        activeBoundaries = bounds;
        if (row && row.symbol) {
            const parsed = parseSymbol(row.symbol);
            const normalized = normalizeSymbol(parsed.base, parsed.quote) || row.symbol;
            boundaryCache.set(row.symbol, bounds);
            if (normalized !== row.symbol) {
                boundaryCache.set(normalized, bounds);
            }
        }
        console.log('[updateSummary] symbol:', row && row.symbol, 'activeBoundaries:', bounds);
        return;
    }
    activeBoundaries = null;
    console.warn('[updateSummary] invalid bounds for symbol:', row.symbol, 'lowP:', row.lowP, 'highP:', row.highP);
}

function updateDetails(row) {
    if (!row) {
        detailsPanel.style.display = 'none';
        detailsJsonEl.textContent = '';
        return;
    }
    detailsJsonEl.textContent = JSON.stringify(row, null, 2);
    detailsPanel.style.display = '';
}

function renderSymbolList(rows) {
    stageSymbolListEl.innerHTML = '';
    symbolRowMap = new Map();
    boundaryCache.clear();
    if (!Array.isArray(rows) || rows.length === 0) {
        stageSymbolListEl.innerHTML = '<div class="muted">暂无币对</div>';
        return;
    }
    rows.forEach(row => {
        if (!row || !row.symbol) {
            return;
        }
        const numericScore = Number(row.score);
        if (Number.isFinite(numericScore) && numericScore < 5000) {
            return;
        }
        const item = document.createElement('div');
        item.className = 'symbol-item';
        item.dataset.symbol = row.symbol;

        const name = document.createElement('span');
        name.className = 'symbol-name';
        name.textContent = row.symbol;

        const qualityInfo = deriveQuality(row.score);
        const quality = document.createElement('span');
        quality.className = 'symbol-quality';
        quality.textContent = `评分：${qualityInfo.grade}`;
        if (qualityInfo && qualityInfo.hint) {
            quality.title = `评分：${formatSummaryValue(row.score)}，规则：${qualityInfo.hint}`;
        }

        item.appendChild(name);
        item.appendChild(quality);

        item.addEventListener('click', () => {
            setActiveSymbol(row.symbol, true);
        });

        stageSymbolListEl.appendChild(item);
        symbolRowMap.set(row.symbol, row);
        const bounds = extractBounds(row);
        if (bounds) {
            const parsed = parseSymbol(row.symbol);
            const normalized = normalizeSymbol(parsed.base, parsed.quote) || row.symbol;
            boundaryCache.set(row.symbol, bounds);
            if (normalized !== row.symbol) {
                boundaryCache.set(normalized, bounds);
            }
        }
    });
}

function markActiveSymbol(symbol) {
    Array.from(stageSymbolListEl.children).forEach(child => {
        if (!(child instanceof HTMLElement)) {
            return;
        }
        child.classList.toggle('active', child.dataset.symbol === symbol);
    });
}

async function fetchKline(symbol, period) {
    const upperSymbol = (symbol || '').toUpperCase();
    if (upperSymbol.includes('-')) {
        const [base, quote] = upperSymbol.split('-');
        const [baseK, quoteK] = await Promise.all([
            fetchKline(base + 'USDT', period),
            fetchKline(quote + 'USDT', period)
        ]);
        const minLen = Math.min(baseK.length, quoteK.length);
        return baseK.slice(0, minLen).map((b, i) => {
            const q = quoteK[i];
            return {
                openT: b.openT,
                openP: (b.openP / q.openP).toPrecision(8),
                highP: (b.highP / q.highP).toPrecision(8),
                lowP: (b.lowP / q.lowP).toPrecision(8),
                closeP: (b.closeP / q.closeP).toPrecision(8)
            };
        });
    }

    const url = `https://fapi.binance.com/fapi/v1/klines?symbol=${upperSymbol}&interval=${period}&limit=960`;
    const resp = await fetch(url);
    if (!resp.ok) {
        throw new Error(`K线接口请求失败 (${resp.status})`);
    }
    const data = await resp.json();
    if (!Array.isArray(data)) {
        throw new Error('K线数据格式异常');
    }
    return data.map(entry => ({
        openT: entry[0],
        openP: Number(entry[1]),
        highP: Number(entry[2]),
        lowP: Number(entry[3]),
        closeP: Number(entry[4])
    }));
}

async function renderKline(base, quote) {
    const symbol = normalizeSymbol(base, quote);
    if (!symbol) {
        chart.clear();
        chartFeedbackEl.textContent = '请选择币对查看K线';
        return;
    }
    const period = periodSelect.value;
    const cachedBounds = boundaryCache.get(symbol) || null;
    const boundariesSnapshot = cachedBounds ? {...cachedBounds} : (activeBoundaries ? {...activeBoundaries} : null);
    const requestId = ++klineRequestId;
    chartFeedbackEl.textContent = '';
    chart.showLoading('default', {
        text: `加载 ${symbol} (${period}) K线...`,
        color: '#64b5f6',
        textColor: '#e0e6f1',
        maskColor: 'rgba(15, 22, 36, 0.45)'
    });
    try {
        const kline = await fetchKline(symbol, period);
        if (requestId !== klineRequestId) {
            return;
        }
        if (!Array.isArray(kline) || kline.length === 0) {
            chartFeedbackEl.textContent = '未获取到有效的K线数据';
            return;
        }
        const times = kline.map(c => new Date(c.openT).toLocaleString());
        const values = kline.map(c => {
            const open = Number(c.openP);
            const close = Number(c.closeP);
            const low = Number(c.lowP);
            const high = Number(c.highP);
            return [open, close, low, high];
        });
        const markLineData = [];
        const formatBoundary = (val, forAxis = false) => {
            if (!Number.isFinite(val)) {
                return '';
            }
            const abs = Math.abs(val);
            if (abs === 0) {
                return forAxis ? '0.00000' : '0';
            }
            if (abs >= 1000) {
                return val.toFixed(0);
            }
            if (abs >= 1) {
                return val.toFixed(4);
            }
            const minDecimals = forAxis ? 5 : 5;
            const dynamicDecimals = Math.ceil(-Math.log10(abs)) + 2;
            const decimals = Math.min(10, Math.max(minDecimals, dynamicDecimals));
            return val.toFixed(decimals);
        };
        console.log('[renderKline] symbol:', symbol, 'period:', period, 'activeBoundaries:', activeBoundaries, 'snapshot:', boundariesSnapshot);
        const boundariesForRender = boundariesSnapshot && Number.isFinite(boundariesSnapshot.low) && Number.isFinite(boundariesSnapshot.high)
            ? boundariesSnapshot
            : (activeBoundaries && Number.isFinite(activeBoundaries.low) && Number.isFinite(activeBoundaries.high)
                ? {...activeBoundaries}
                : null);
        if (boundariesForRender && Number.isFinite(boundariesForRender.low)) {
            markLineData.push({
                yAxis: boundariesForRender.low,
                lineStyle: {color: '#f0b429', type: 'dashed', width: 1.5},
                label: {formatter: `低位 ${formatBoundary(boundariesForRender.low)}`}
            });
        }
        if (boundariesForRender && Number.isFinite(boundariesForRender.high)) {
            markLineData.push({
                yAxis: boundariesForRender.high,
                lineStyle: {color: '#ab47bc', type: 'dashed', width: 1.5},
                label: {formatter: `高位 ${formatBoundary(boundariesForRender.high)}`}
            });
        }
        if (!markLineData.length) {
            console.warn('[renderKline] markLine omitted due to invalid boundaries for symbol:', symbol, 'bounds(active):', activeBoundaries, 'bounds(snapshot):', boundariesSnapshot);
        } else {
            console.log('[renderKline] markLineData:', markLineData);
        }
        const seriesConfig = {
            name: symbol,
            type: 'candlestick',
            data: values,
            itemStyle: {
                color: '#26a69a',
                color0: '#ef5350',
                borderColor: '#26a69a',
                borderColor0: '#ef5350'
            },
            emphasis: {
                itemStyle: {color: '#2ec7c9', color0: '#f4606c'}
            }
        };
        if (markLineData.length) {
            seriesConfig.markLine = {
                symbol: 'none',
                data: markLineData
            };
        }
        chart.setOption({
            backgroundColor: '#0f1624',
            grid: {
                left: '10%',
                right: '10%',
                top: '10%',
                bottom: '15%',
                backgroundColor: '#111b2d',
                borderColor: '#1f2a48'
            },
            dataZoom: [
                {type: 'inside', start: 60, end: 100},
                {type: 'slider', start: 0, end: 100, height: 20, bottom: 10}
            ],
            tooltip: {
                trigger: 'axis',
                axisPointer: {type: 'cross'},
                formatter(params) {
                    const k = params[0];
                    const [idx, open, close, low, high] = k.data;
                    const change = open ? ((close - open) / open * 100).toFixed(2) : '0.00';
                    return [
                        `时间：${k.axisValueLabel}`,
                        `开盘：${Number(open).toPrecision(8)}`,
                        `收盘：${Number(close).toPrecision(8)}`,
                        `最低：${Number(low).toPrecision(8)}`,
                        `最高：${Number(high).toPrecision(8)}`,
                        `涨跌幅：${change}%`
                    ].join('<br/>');
                }
            },
            xAxis: {
                type: 'category',
                data: times,
                min: 'dataMin',
                max: value => value.max + (value.max - value.min) * 0.05,
                axisLine: {lineStyle: {color: '#2c3e50'}},
                axisLabel: {color: '#8fa3bf'},
                splitLine: {show: true, lineStyle: {color: '#1f2a48'}}
            },
            yAxis: {
                type: 'value',
                scale: true,
                position: 'right',
                axisLine: {lineStyle: {color: '#2c3e50'}},
                axisLabel: {
                    color: '#8fa3bf',
                    formatter(value) {
                        return formatBoundary(value, true);
                    }
                },
                splitLine: {show: true, lineStyle: {color: '#1f2a48'}}
            },
            series: [{
                ...seriesConfig
            }]
        });
        chart.resize();
        chartFeedbackEl.textContent = '';
    } catch (err) {
        if (requestId !== klineRequestId) {
            return;
        }
        chartFeedbackEl.textContent = `K线加载失败：${err.message}`;
    } finally {
        if (requestId === klineRequestId) {
            chart.hideLoading();
        }
    }
}

function setActiveSymbol(symbol, withChart) {
    if (!symbolRowMap.has(symbol)) {
        return;
    }
    const row = symbolRowMap.get(symbol);
    const {base, quote} = parseSymbol(symbol);
    activeSymbol = normalizeSymbol(base, quote);
    markActiveSymbol(symbol);
    updateSummary(row);
    updateDetails(row);
    assignInputValues(base, quote);
    if (withChart) {
        renderKline(base, quote).catch(err => {
            console.error(err);
        });
    }
}

function selectSymbolByName(symbol, renderChart = true) {
    if (!symbol) {
        return;
    }
    if (symbolRowMap.has(symbol)) {
        setActiveSymbol(symbol, renderChart);
        return;
    }
    const {base, quote} = parseSymbol(symbol);
    const normalized = normalizeSymbol(base, quote);
    if (!normalized) {
        chartFeedbackEl.textContent = '无法解析该币对';
        return;
    }
    assignInputValues(base, quote);
    activeSymbol = normalized;
    markActiveSymbol('');
    const row = symbolRowMap.get(normalized) || null;
    updateSummary(row || {symbol: normalized});
    updateDetails(row || null);
    if (renderChart) {
        renderKline(base, quote).catch(err => console.error(err));
    }
}

function applyManualSymbol() {
    const {symbol} = getInputSymbol();
    if (!symbol) {
        chartFeedbackEl.textContent = '请输入 base/quote';
        return;
    }
    chartFeedbackEl.textContent = '';
    selectSymbolByName(symbol, true);
}

async function renderStage(stagePath, stageLabel) {
    if (!stagePath) {
        setStageMessage('请选择阶段');
        workspace.style.display = 'none';
        return;
    }
    setStageMessage('阶段数据加载中...');
    workspace.style.display = 'none';
    chart.clear();
    chartFeedbackEl.textContent = '';
    try {
        const query = buildCycleQuery(currentCycleKey);
        const {
            data,
            savedAt,
            batchTimestamp,
            stage,
            cycleKey: stageCycleKey,
            cycleHours: stageCycleHours,
            cycleDays: stageCycleDays
        } = await fetchJson(`/api/data/${stagePath}${query}`);
        const stageName = stageLabel || stage;
        if (!data || !Array.isArray(data) || data.length === 0) {
            setStageMessage(`阶段 ${stageName} 暂无数据`);
            workspace.style.display = 'none';
            activeSymbol = '';
            markActiveSymbol('');
            assignInputValues('', '');
            return;
        }
        const sorted = data.slice().sort((a, b) => {
            const scoreA = Number(a && a.score !== undefined ? a.score : 0);
            const scoreB = Number(b && b.score !== undefined ? b.score : 0);
            if (Number.isNaN(scoreA) && Number.isNaN(scoreB)) {
                return 0;
            }
            if (Number.isNaN(scoreA)) {
                return 1;
            }
            if (Number.isNaN(scoreB)) {
                return -1;
            }
            return scoreB - scoreA;
        });
        currentRows = sorted;
        renderSymbolList(sorted);
        const visibleSymbols = Array.from(symbolRowMap.keys());
        if (typeof stageCycleKey === 'string' && stageCycleKey) {
            currentCycleKey = stageCycleKey;
            if (cycleSelect) {
                cycleSelect.value = stageCycleKey;
            }
        }
        setCycleMeta({cycleHours: stageCycleHours, cycleDays: stageCycleDays});
        const cycleHours = cachedCycleMeta && cachedCycleMeta.cycleHours;
        const cycleDays = cachedCycleMeta && cachedCycleMeta.cycleDays;
        const cycleText = Number.isFinite(cycleHours) && Number.isFinite(cycleDays)
            ? `${cycleDays} 天 (${cycleHours} 小时)`
            : '未知';
        const savedText = savedAt ? formatDateTime(savedAt) : '未知';

        const summaryHtml = [
            `<div class="overview-item"><span class="overview-label">阶段</span><span class="overview-value">${stageName}</span></div>`,
            `<div class="overview-item"><span class="overview-label">量化周期</span><span class="overview-value">${cycleText}</span></div>`,
            `<div class="overview-item"><span class="overview-label">批次时间</span><span class="overview-value">${formatDateTime(batchTimestamp)}</span></div>`,
            `<div class="overview-item"><span class="overview-label">阶段更新</span><span class="overview-value">${savedText}</span></div>`,
            `<div class="overview-item"><span class="overview-label">币对数量</span><span class="overview-value">${visibleSymbols.length}</span></div>`
        ].join('');
        setStageSummary(summaryHtml);
        workspace.style.display = 'flex';
        requestAnimationFrame(() => chart.resize());

        const defaultSymbol = activeSymbol && symbolRowMap.has(activeSymbol)
            ? activeSymbol
            : visibleSymbols[0];
        if (defaultSymbol) {
            setActiveSymbol(defaultSymbol, true);
        } else {
            chartFeedbackEl.textContent = '该阶段暂无币对';
            chart.clear();
            summaryMetricsEl.innerHTML = '<span class="muted">暂无数据</span>';
            detailsPanel.style.display = 'none';
            activeSymbol = '';
            markActiveSymbol('');
            assignInputValues('', '');
        }
    } catch (err) {
        setStageMessage('阶段数据加载失败: ' + err.message);
        workspace.style.display = 'none';
        throw err;
    }
}

async function loadSymbolAndPairs() {
    try {
        const query = buildCycleQuery(currentCycleKey);
        const [symbolResp, pairResp] = await Promise.all([
            fetchJson(`/api/data/symbol-list${query}`).catch(() => null),
            fetchJson(`/api/data/pairs${query}`).catch(() => null)
        ]);
        renderLinkList(
            initialListSpan,
            symbolResp && symbolResp.data,
            symbolListMeta,
            symbolResp && symbolResp.savedAt
        );
        renderLinkList(
            pairListSpan,
            pairResp && pairResp.data,
            pairListMeta,
            pairResp && pairResp.savedAt
        );
        listsSection.style.display = '';
    } catch (err) {
        initialListSpan.textContent = '加载失败';
        pairListSpan.textContent = '加载失败';
        if (symbolListMeta) {
            symbolListMeta.textContent = '';
        }
        if (pairListMeta) {
            pairListMeta.textContent = '';
        }
        listsSection.style.display = '';
    }
}

async function populateStageOptions(summary) {
    stageSelect.disabled = true;
    stageSelect.innerHTML = '<option value="">加载中...</option>';
    try {
        const effectiveSummary = summary || await fetchCycleSummary(currentCycleKey);
        if (!summary) {
            populateCycleSelect(effectiveSummary);
        }
        if (typeof effectiveSummary.cycleKey === 'string') {
            currentCycleKey = effectiveSummary.cycleKey;
            if (cycleSelect) {
                cycleSelect.value = effectiveSummary.cycleKey;
            }
        }
        setCycleMeta(effectiveSummary);
        const stageSummaryArray = Array.isArray(effectiveSummary.stageSummary) ? effectiveSummary.stageSummary : [];
        const stageSummaryMap = new Map(stageSummaryArray.map(item => [item.stage, item]));
        let fallbackStage = null;
        const optionsHtml = STAGE_OPTIONS.map(opt => {
            const stageInfo = stageSummaryMap.get(opt.stage);
            const disabled = !stageInfo || stageInfo.size === 0;
            if (!disabled && !fallbackStage) {
                fallbackStage = opt;
            }
            const label = `${opt.label}${stageInfo && stageInfo.savedAt ? ` (${formatDateTime(stageInfo.savedAt)})` : ''}`;
            return `<option value="${opt.value}" ${disabled ? 'disabled' : ''}>${label}</option>`;
        });
        stageSelect.innerHTML = optionsHtml.join('') || '<option value="">无可用阶段</option>';
        stageSelect.disabled = false;

        let stageMeta = null;
        const preservedMeta = STAGE_META_BY_VALUE[currentStageValue];
        if (preservedMeta) {
            const info = stageSummaryMap.get(preservedMeta.stage);
            if (info && info.size > 0) {
                stageMeta = preservedMeta;
            }
        }
        if (!stageMeta) {
            const defaultMeta = STAGE_META_BY_VALUE[DEFAULT_STAGE];
            if (defaultMeta) {
                const info = stageSummaryMap.get(defaultMeta.stage);
                if (info && info.size > 0) {
                    stageMeta = defaultMeta;
                }
            }
        }
        if (!stageMeta) {
            stageMeta = fallbackStage;
        }
        if (!stageMeta) {
            setStageMessage('暂无可展示阶段');
            workspace.style.display = 'none';
            return;
        }
        currentStageValue = stageMeta.value;
        stageSelect.value = stageMeta.value;
        await renderStage(stageMeta.value, stageMeta.label);
    } catch (err) {
        setStageMessage('阶段概览加载失败: ' + err.message);
        stageSelect.innerHTML = '<option value="">加载失败</option>';
        stageSelect.disabled = true;
        workspace.style.display = 'none';
        throw err;
    }
}

if (cycleSelect) {
    cycleSelect.addEventListener('change', () => {
        const selectedKey = cycleSelect.value;
        if (currentCycleKey === selectedKey) {
            return;
        }
        currentCycleKey = selectedKey;
        currentStageValue = DEFAULT_STAGE;
        (async () => {
            try {
                const summary = await fetchCycleSummary(currentCycleKey);
                populateCycleSelect(summary);
                setCycleMeta(summary);
                await loadSymbolAndPairs();
                await populateStageOptions(summary);
            } catch (err) {
                console.error('[cycleSelect] 切换周期失败:', err);
                setStageMessage('阶段概览加载失败: ' + err.message);
                stageSelect.innerHTML = '<option value="">加载失败</option>';
                stageSelect.disabled = true;
                workspace.style.display = 'none';
            }
        })().catch(err => console.error(err));
    });
}

stageSelect.addEventListener('change', () => {
    const selectedValue = stageSelect.value;
    const optionMeta = STAGE_META_BY_VALUE[selectedValue];
    if (!selectedValue || !optionMeta) {
        currentStageValue = '';
        setStageMessage('请选择阶段');
        workspace.style.display = 'none';
        chart.clear();
        chartFeedbackEl.textContent = '';
        summaryMetricsEl.innerHTML = '<span class="muted">请选择阶段</span>';
        return;
    }
    currentStageValue = selectedValue;
    renderStage(selectedValue, optionMeta.label).catch(err => console.error(err));
});

periodSelect.addEventListener('change', () => {
    const {base, quote, symbol} = getInputSymbol();
    if (symbol) {
        renderKline(base, quote).catch(err => console.error(err));
        return;
    }
    if (activeSymbol) {
        const parsed = parseSymbol(activeSymbol);
        renderKline(parsed.base, parsed.quote).catch(err => console.error(err));
    }
});

symbolApplyBtn.addEventListener('click', applyManualSymbol);
[baseInput, quoteInput].forEach(input => {
    input.addEventListener('keydown', event => {
        if (event.key === 'Enter') {
            applyManualSymbol();
        }
    });
});

window.addEventListener('resize', () => {
    chart.resize();
});

(async function initialize() {
    try {
        const summary = await fetchCycleSummary();
        populateCycleSelect(summary);
        setCycleMeta(summary);
        await loadSymbolAndPairs();
        await populateStageOptions(summary);
    } catch (err) {
        setStageMessage('初始化失败: ' + err.message);
    }
})();
