// server.js
import express from 'express'
import axios from "axios";

const app = express();
const port = 3000;

async function listKline(symbol, period) {
    symbol = symbol.toUpperCase();
    if (!symbol.endsWith('USDT')) {
        let [base, quota] = symbol.split('-');
        symbol = base.concat('USDT');
        let baseKlines = await listKline(symbol, period);
        symbol = quota.concat('USDT');
        let quotaKlines = await listKline(symbol, period);
        // 合并k线
        return baseKlines.map((baseKline, idx) => {
            let quotaKline = quotaKlines[idx];
            return {
                openT: baseKline.openT,
                openP: (baseKline.openP / quotaKline.openP).toPrecision(4),
                highP: (baseKline.highP / quotaKline.highP).toPrecision(4),
                lowP: (baseKline.lowP / quotaKline.lowP).toPrecision(4),
                closeP: (baseKline.closeP / quotaKline.closeP).toPrecision(4)
            }
        })
    }
    let url = 'https://api.binance.com/api/v3/klines?symbol=' + symbol + '&interval=' + period + '&limit=960'
    return (await axios.get(url, {})).data.map(function (ele) {
        return {
            openT: ele[0], openP: ele[1], highP: ele[2], lowP: ele[3], closeP: ele[4]
        }
    });
}

app.get('/kline/:symbol/:period', async (req, res, next) => {
    try {
        const {symbol, period} = req.params;
        // 1. 等待拿到原始数据
        const data = await listKline(symbol, period);
        if (!data) return res.status(400).json({error: '1'});
        // 4. 最后返回
        res.json(data);
    } catch (err) {
        next(err);
    }
});

app.get('/', (req, res) => {
    const defaultSymbol = 'BTCUSDT';
    res.send(`
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <title>动态 K 线图</title>
  <style>
    body { margin: 0; padding: 10px; font-family: Arial, sans-serif }
    #controls { margin-bottom: 10px }
    #chart { width: 100%; height: 600px }
  </style>
  <script src="https://cdn.jsdelivr.net/npm/echarts/dist/echarts.min.js"></script>
</head>
<body>
  <div id="controls">
     <label>币种：</label>
     <input id="symbol" list="symbols" value="${defaultSymbol}" placeholder="ETH-BTC" />

    <label style="margin-left:20px">周期：</label>
    <select id="period">
      <option value="1m">1 分钟</option>
      <option value="5m" selected>5 分钟</option>
      <option value="15m">15 分钟</option>
      <option value="30m">30 分钟</option>
      <option value="1h">1 小时</option>
      <option value="4h">4 小时</option>
    </select>
  </div>
  <div id="chart"></div>

  <script>
    const chart = echarts.init(document.getElementById('chart'));

    // 从下拉框读当前选择
    function getParams() {
      return {
        symbol: document.getElementById('symbol').value,
        period: document.getElementById('period').value
      };
    }

    // 请求并渲染
    async function render() {
      const { symbol, period } = getParams();
      const resp = await fetch(\`/kline/\${symbol}/\${period}\`);
      if (!resp.ok) {
        console.error(await resp.json());
        return;
      }
      const agg = await resp.json();
      const times  = agg.map(c => new Date(c.openT).toLocaleString());
      const values = agg.map(c => [c.openP, c.closeP, c.lowP, c.highP]);

      chart.setOption({
        // 整体背景
        backgroundColor: '#0f1624', // 深色背景

          // 网格区域样式
          grid: {
            left: '10%',
            right: '10%',
            bottom: '15%',
            top: '10%',
            backgroundColor: '#111b2d', // 网格内部背景
            borderColor: '#1f2a48'      // 网格边框色
          },
         // ① 加入 dataZoom，支持内置缩放和底部滑杆
        dataZoom: [
        { 
            type: 'inside',   // 鼠标滚轮、拖拽缩放都可用
            start: 50,          // 默认显示百分比范围，0%–100%
            end: 100
        },
        { 
            type: 'slider',    // 底部滑杆
            start: 0,
            end: 100,
            height: 20,        // 滑杆高度，可自定义
            bottom: 10         // 距底部距离
        }
        ],
        tooltip: { trigger: 'axis', axisPointer: { type: 'cross' }},
        xAxis: { type: 'category', data: times ,  min: 'dataMin',
            max: function(value) {
                return value.max + (value.max - value.min) * 0.05;
            } 
        },
        yAxis: { type: 'value',scale: true,position: 'right'},
       series: [{
        name: 'K 线',
        type: 'candlestick',
        data: values,
        itemStyle: {
          // 阳线（涨）绿色、阴线（跌）红色
          color: '#26a69a',
          color0: '#ef5350',
          borderColor: '#26a69a',
          borderColor0: '#ef5350'
        },
        // 可选：给阴阳烛体加点渐变
        emphasis: {
          itemStyle: {
            color: '#2ec7c9',
            color0: '#f4606c'
          }
        }
      }]
      });
    }

    // 事件绑定：币种 & 周期变化都重新渲染
    document.getElementById('symbol')
      .addEventListener('keydown', e => {
        if (e.key === 'Enter') {
             render();
         }
        });
    document.getElementById('period')
      .addEventListener('change', render);
    // 首次渲染
    render();
  </script>
</body>
</html>
  `);
});
app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
});
