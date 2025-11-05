const form = document.getElementById('task-form');
const submitButton = document.getElementById('task-submit');
const feedbackBox = document.getElementById('submission-feedback');
const taskList = document.getElementById('task-list');
const extraBuysList = document.getElementById('extra-buys-list');
const extraBuysAddButton = document.getElementById('extra-buys-add');

function setFeedback(type, message) {
    if (!feedbackBox) {
        return;
    }
    feedbackBox.textContent = message;
    feedbackBox.classList.remove('hidden', 'success', 'error');
    feedbackBox.classList.add(type === 'success' ? 'success' : 'error');
}

function clearFeedback() {
    if (!feedbackBox) {
        return;
    }
    feedbackBox.classList.add('hidden');
    feedbackBox.textContent = '';
}

function normalizeAsset(value) {
    return (value || '').trim().toUpperCase();
}

function stripQuoteSymbol(asset) {
    const value = normalizeAsset(asset);
    if (!value) {
        return '';
    }
    const suffixes = ['USDT', 'USDC', 'BUSD', 'BTC', 'ETH'];
    for (const suffix of suffixes) {
        if (value.endsWith(suffix) && value.length > suffix.length) {
            return value.slice(0, -suffix.length);
        }
    }
    if (value.includes('-')) {
        return value.split('-')[0];
    }
    return value;
}

function deriveTaskId(baseAssert, quoteAssert) {
    const base = stripQuoteSymbol(baseAssert);
    const quote = stripQuoteSymbol(quoteAssert);
    if (base && quote) {
        return `${base}-${quote}`;
    }
    if (base) {
        return base;
    }
    if (quote) {
        return quote;
    }
    return `GRID-${Date.now()}`;
}

function toNullableNumber(value) {
    if (value === undefined || value === null) {
        return null;
    }
    const source = typeof value === 'string' ? value.trim() : value;
    if (source === '') {
        return null;
    }
    const num = Number(source);
    return Number.isFinite(num) ? num : null;
}

function serializeForm(formData) {
    const payload = {};
    formData.forEach((value, key) => {
        const trimmedKey = key.trim();
        if (!trimmedKey) {
            return;
        }
        if (trimmedKey === 'doubled' || trimmedKey === 'reversed') {
            return;
        }
        const trimmedValue = typeof value === 'string' ? value.trim() : value;
        payload[trimmedKey] = trimmedValue;
    });
    payload.doubled = formData.has('doubled');
    payload.reversed = formData.has('reversed');
    payload.baseAssert = normalizeAsset(payload.baseAssert);
    payload.quoteAssert = normalizeAsset(payload.quoteAssert);
    payload.id = deriveTaskId(payload.baseAssert, payload.quoteAssert);
    return payload;
}

function formatRate(rate) {
    if (rate === undefined || rate === null || rate === '') {
        return '—';
    }
    const num = Number(rate);
    if (!Number.isFinite(num) || num <= 0) {
        return '—';
    }
    return `${(num * 100).toFixed(2)}%`;
}

function formatAmount(value) {
    if (value === undefined || value === null || value === '') {
        return '—';
    }
    const num = Number(value);
    return Number.isFinite(num) ? num : '—';
}

function renderTaskList(tasks) {
    if (!taskList) {
        return;
    }
    if (!Array.isArray(tasks) || !tasks.length) {
        taskList.innerHTML = '<div class="empty-hint">暂无网格任务，提交表单即可创建。</div>';
        return;
    }
    taskList.innerHTML = tasks.map(task => {
        const id = task?.id ?? '未命名';
        const baseAssert = task?.baseAssert ?? '—';
        const quoteAssert = task?.quoteAssert ?? '—';
        const gridRate = formatRate(task?.gridRate);
        const gridValue = formatAmount(task?.gridValue);
        const status = task?.status ?? '—';
        return `
            <div class="task-list-item">
                <strong>${id}</strong>
                <div class="task-meta">
                    <span>Buy leg: ${baseAssert}</span>
                    <span>Sell leg: ${quoteAssert}</span>
                    <span>网格间距: ${gridRate}</span>
                    <span>单格投入: ${gridValue}</span>
                    <span>状态: ${status}</span>
                </div>
            </div>
        `;
    }).join('');
}

function syncExtraBuysEmptyState() {
    if (!extraBuysList) {
        return;
    }
    const rows = extraBuysList.querySelectorAll('.extra-buy-row');
    if (!rows.length) {
        addExtraBuyRow();
    }
}

function createExtraBuyRow() {
    const row = document.createElement('div');
    row.className = 'extra-buy-row';
    row.innerHTML = `
        <label class="field">
            <span>触发价格</span>
            <input type="number" step="any" placeholder="例如 0.85" class="extra-buy-price">
        </label>
        <label class="field">
            <span>买入倍数</span>
            <input type="number" step="any" placeholder="例如 1.5" class="extra-buy-mul">
        </label>
        <button type="button" class="extra-buy-remove">删除</button>
    `;
    const removeButton = row.querySelector('.extra-buy-remove');
    if (removeButton) {
        removeButton.addEventListener('click', () => {
            row.remove();
            syncExtraBuysEmptyState();
        });
    }
    return row;
}

function addExtraBuyRow() {
    if (!extraBuysList) {
        return;
    }
    const row = createExtraBuyRow();
    extraBuysList.appendChild(row);
}

function resetExtraBuys() {
    if (!extraBuysList) {
        return;
    }
    extraBuysList.innerHTML = '';
    addExtraBuyRow();
}

function collectExtraBuys() {
    if (!extraBuysList) {
        return {items: []};
    }
    const rows = Array.from(extraBuysList.querySelectorAll('.extra-buy-row'));
    const items = [];
    for (const row of rows) {
        const priceInput = row.querySelector('.extra-buy-price');
        const mulInput = row.querySelector('.extra-buy-mul');
        const rawPrice = priceInput ? priceInput.value.trim() : '';
        const rawMul = mulInput ? mulInput.value.trim() : '';
        const hasPrice = rawPrice !== '';
        const hasMul = rawMul !== '';
        if (!hasPrice && !hasMul) {
            continue;
        }
        if (!hasPrice || !hasMul) {
            return {error: '额外买入订单需同时填写价格与倍数'};
        }
        const price = toNullableNumber(rawPrice);
        const mul = toNullableNumber(rawMul);
        if (price === null || price <= 0) {
            return {error: '额外买入订单的价格需为正数'};
        }
        if (mul === null || mul <= 0) {
            return {error: '额外买入订单的买入倍数需为正数'};
        }
        items.push({price, mul});
    }
    if (items.length > 1) {
        items.sort((a, b) => b.price - a.price);
    }
    return {items};
}

async function loadTasks() {
    if (!taskList) {
        return;
    }
    taskList.innerHTML = '<div class="empty-hint">加载中...</div>';
    try {
        const response = await fetch(`/grid/data/grid_tasks.json?ts=${Date.now()}`, {cache: 'no-store'});
        if (!response.ok) {
            throw new Error(`加载失败 ${response.status}`);
        }
        const tasks = await response.json();
        renderTaskList(Array.isArray(tasks) ? tasks : []);
    } catch (err) {
        console.error('加载任务失败', err);
        taskList.innerHTML = '<div class="empty-hint">无法读取现有任务，请稍后重试。</div>';
    }
}

async function handleSubmit(event) {
    event.preventDefault();
    clearFeedback();
    const formData = new FormData(form);
    const payload = serializeForm(formData);

    if (!payload.baseAssert) {
        setFeedback('error', 'baseAssert 不能为空');
        return;
    }
    if (payload.doubled && !payload.quoteAssert) {
        setFeedback('error', '双币网格需要填写 quoteAssert');
        return;
    }

    const gridRateNum = Number(payload.gridRate);
    if (!Number.isFinite(gridRateNum) || gridRateNum <= 0) {
        setFeedback('error', 'gridRate 需要为正数');
        return;
    }
    const gridValueNum = Number(payload.gridValue);
    if (!Number.isFinite(gridValueNum) || gridValueNum <= 0) {
        setFeedback('error', 'gridValue 需要为正数');
        return;
    }

    const startPriceNum = toNullableNumber(payload.startPrice);
    if (payload.startPrice && startPriceNum === null) {
        setFeedback('error', 'startPrice 需要为数字');
        return;
    }
    const takeProfitNum = toNullableNumber(payload.takeProfitPrice);
    if (payload.takeProfitPrice && takeProfitNum === null) {
        setFeedback('error', 'takeProfitPrice 需要为数字');
        return;
    }

    const initPositionBaseLvl = toNullableNumber(payload.initPositionBaseLvl);
    const initPositionQuoteLvl = toNullableNumber(payload.initPositionQuoteLvl);
    delete payload.initPositionBaseLvl;
    delete payload.initPositionQuoteLvl;

    const hasBaseInit = initPositionBaseLvl !== null && initPositionBaseLvl !== 0;
    const hasQuoteInit = initPositionQuoteLvl !== null && initPositionQuoteLvl !== 0;
    if (hasBaseInit && !Number.isInteger(initPositionBaseLvl)) {
        setFeedback('error', 'base建仓倍数需要为整数');
        return;
    }
    if (hasQuoteInit && !Number.isInteger(initPositionQuoteLvl)) {
        setFeedback('error', 'quote建仓倍数需要为整数');
        return;
    }
    if (hasBaseInit) {
        payload.initPosition = {baseQtyLvl: initPositionBaseLvl};
    }
    if (hasQuoteInit) {
        payload.initPosition = {
            ...(payload.initPosition || {}),
            quoteQtyLvl: initPositionQuoteLvl
        };
    }

    const extraBuysResult = collectExtraBuys();
    if (extraBuysResult.error) {
        setFeedback('error', extraBuysResult.error);
        return;
    }
    if (extraBuysResult.items.length) {
        payload.extraBuys = extraBuysResult.items;
    } else {
        delete payload.extraBuys;
    }

    payload.gridRate = gridRateNum;
    payload.gridValue = gridValueNum;
    payload.startPrice = startPriceNum;
    payload.takeProfitPrice = takeProfitNum;
    payload.quoteAssert = payload.quoteAssert || null;
    payload.status = 'PENDING';

    try {
        submitButton.disabled = true;
        const response = await fetch('/api/grid/tasks', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) {
            const message = result?.error || '提交失败，请检查输入';
            setFeedback('error', message);
            return;
        }
        form.reset();
        resetExtraBuys();
        setFeedback('success', `任务 ${result?.task?.id ?? ''} 创建成功`);
        await loadTasks();
    } catch (err) {
        console.error('创建任务异常', err);
        setFeedback('error', '网络异常，稍后再试');
    } finally {
        submitButton.disabled = false;
    }
}

if (form) {
    form.addEventListener('submit', handleSubmit);
}

if (extraBuysAddButton) {
    extraBuysAddButton.addEventListener('click', () => {
        addExtraBuyRow();
    });
}

syncExtraBuysEmptyState();

loadTasks();
