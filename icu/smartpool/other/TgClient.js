const TelegramBot = require('node-telegram-bot-api');
const bot = new TelegramBot('6322218866:AAE11lydYjiRA5ll982O-L-U0D340rbTA-8', {polling: true});
const chatId = '-1001900319185';


bot.onText(/\/start/, (msg) => {
    bot.sendMessage(chatId, '欢迎来到Bot世界！').then(r => console.log(r));
});

bot.on('message', (msg) => {
    const text = msg.text || '';
    if (text.charAt(0) === '/') {
        return;
    }
    console.log(`收到消息: ${msg.text}`);
});







