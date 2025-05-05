// server.js
import express from 'express'
import models from "../common/Models.js";
import czClient from "../service/CzClient.js";

const app = express();
const port = 3000;

const symbols = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT']

async function listKline(symbol, period) {
    // let url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${period}&limit=60`
    // let resp = await axios.get(url, {});

    return await czClient.listKline(models.klineParam(symbol, 60 * 16, null, null, period));
}

// 1. K 线数据接口
app.get('/kline/:symbol/:period', async (req, res, next) => {
    try {
        const {symbol, period} = req.params;
        const periodMin = parseInt(period, 10);
        // 1. 等待拿到原始数据
        const data = await listKline(symbol, period);
        if (!data) return res.status(404).json({error: 'symbol not found'});
        // 4. 最后返回
        res.json(data);
    } catch (err) {
        next(err);
    }
});

// 2. 根路由：返回带下拉框和 ECharts 的 HTML
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
     <input id="symbol" list="symbols" value="${defaultSymbol}" placeholder="请输入或选择币种" />
     <datalist id="symbols">
    ${symbols.map(s => `<option value="${s}">`).join('')}
     </datalist>

    
    <label style="margin-left:20px">周期：</label>
    <select id="period">
      <option value="1m">1 分钟</option>
      <option value="5m">5 分钟</option>
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
        xAxis: { type: 'category', data: times },
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


// 启动
app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
});
