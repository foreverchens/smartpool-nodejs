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


