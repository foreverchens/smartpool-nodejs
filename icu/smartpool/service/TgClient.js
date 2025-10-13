import TelegramBot from 'node-telegram-bot-api'

const bot = new TelegramBot('6322218866:AAE11lydYjiRA5ll982O-L-U0D340rbTA-8', {polling: true});
const chatId = '-1001900319185';
const languageKeyboard = {
    reply_markup: {
        inline_keyboard: [[{
            text: '汇率标的', callback_data: 'smartpool'
        }, {
            text: '结束网格', callback_data: 'gridInterrupt'
        }],]
    }
};


bot.on('message', (msg) => {
    const text = msg.text || '';
    if (text.charAt(0) === '/') {
        return;
    }
    console.log(`收到消息: ${msg.text}`);
});


bot.onText(/\/start/, (msg) => {
    bot.sendMessage(chatId, 'ha', languageKeyboard).then(r => console.log('/start'));
});

bot.on('callback_query', (callbackQuery) => {
    const message = callbackQuery.message;
    const key = callbackQuery.data;

    bot.answerCallbackQuery(callbackQuery.id);
    let response = '';
    switch (key) {

    }
    bot.sendMessage(message.chat.id, response);
});




function formatFancyTable(data) {
    const headers = Object.keys(data[0]);
    const rows = data.map(row => headers.map(h => String(row[h])));

    // 计算每列最大宽度
    const colWidths = headers.map((_, i) => Math.max(headers[i].length, ...rows.map(r => r[i].length)));

    // 居中填充
    const center = (text, width) => {
        const space = width - text.length;
        const left = Math.floor(space / 2);
        const right = space - left;
        return ' '.repeat(left) + text + ' '.repeat(right);
    };

    // 行构建器
    const makeLine = (left, sep, right, fill) => left + colWidths.map(w => fill.repeat(w + 2)).join(sep) + right;

    const formatRow = (row) => '│' + row.map((cell, i) => ' ' + center(cell, colWidths[i]) + ' ').join('│') + '│';

    const top = makeLine('┌', '┬', '┐', '─');
    const mid = makeLine('├', '┼', '┤', '─');
    const bot = makeLine('└', '┴', '┘', '─');

    const headerRow = formatRow(headers);
    const bodyRows = rows.map(formatRow);

    return [top, headerRow, mid, ...bodyRows, bot].join('\n');
}


// console.log(smartPoolRltView());


