// logger.js  —— 稳定版：日期在前文件名 + 控制台/文件双写
// 关键点：在 logger.info/error 等方法被调用时立即解析调用栈，避免 layout 阶段丢失真实帧

import fs from 'fs';
import log4js from 'log4js';
import path from 'path';
import {fileURLToPath} from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const LOG_DIR = path.join(__dirname, 'logs');
if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, {recursive: true});

// === 工具 ===
const pad = (n) => String(n).padStart(2, '0');
const dateStr = (d = new Date()) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
const nowISO = () => new Date().toISOString().replace('T', ' ').replace('Z', '');
const TODAY = () => dateStr(new Date()); // 用于初始化与换日检测

function normalizePath(p) {
    if (!p) return '';
    return p.replace(/^file:\/\//, '').replace(/\\/g, '/');
}

const THIS_FILE = normalizePath(__filename);
const THIS_BASENAME = path.basename(THIS_FILE);

// 解析“真实调用者”栈帧（在*调用点*执行）
function getCallerFrame() {
    const err = new Error();
    const stack = (err.stack || '').split('\n').slice(1);

    for (const line of stack) {
        // 两种格式：
        // at func (absPath:line:col)
        // at absPath:line:col
        const m1 = line.match(/\s*at\s+(.*?)\s+\((.*):(\d+):(\d+)\)/);
        const m2 = line.match(/\s*at\s+(.*):(\d+):(\d+)/);

        let fn = 'anonymous', file = '', ln = '';
        if (m1) {
            fn = m1[1];
            file = m1[2];
            ln = m1[3];
        } else if (m2) {
            fn = '<anonymous>';
            file = m2[1];
            ln = m2[2];
        } else {
            continue;
        }

        file = normalizePath(file);

        // 跳过内部帧：log4js、自身 logger.js、node 内部
        if (!file) continue;
        if (file.includes('/node_modules/log4js/')) continue;
        if (file.includes('/internal/') || file.includes('node:internal')) continue;
        if (file === THIS_FILE || file.endsWith('/' + THIS_BASENAME)) continue;

        return {functionName: fn, file, line: ln};
    }
    return {functionName: '<unknown>', file: '<unknown>', line: '0'};
}

// === 基于“日期在前”的文件路径 ===
function pathsFor(dateStrYmd) {
    return {
        errorFile: path.join(LOG_DIR, `${dateStrYmd}-error.log`),
        infoFile: path.join(LOG_DIR, `${dateStrYmd}-info.log`),
    };
}

// === 配置 log4js（不在 layout 里取栈，layout 仅负责排版） ===
function configure(dateYmd) {
    const {errorFile, infoFile} = pathsFor(dateYmd);
    log4js.configure({
        appenders: {
            console: {
                type: 'stdout',
                // ✅ 用 hh（log4js 的小时 token），而不是 HH
                layout: {type: 'pattern', pattern: '[%d{yyyy-MM-dd hh:mm:ss.SSS}] %-5p %m'},
            },
            errorFile: {
                type: 'file',
                filename: errorFile,
                layout: {type: 'pattern', pattern: '[%d{yyyy-MM-dd hh:mm:ss.SSS}] %-5p %m'},
            },
            infoFile: {
                type: 'file',
                filename: infoFile,
                layout: {type: 'pattern', pattern: '[%d{yyyy-MM-dd hh:mm:ss.SSS}] %-5p %m'},
            },
            errorOnly: {type: 'logLevelFilter', appender: 'errorFile', level: 'error'},
            importantOnly: {type: 'logLevelFilter', appender: 'infoFile', level: 'info', maxLevel: 'warn'},
        },
        categories: {
            default: {appenders: ['console', 'errorOnly', 'importantOnly'], level: 'debug'},
        },
    });
}
// === 初始化 ===
let currentDate = TODAY();
configure(currentDate);
const base = log4js.getLogger(); // 基础 logger（不直接暴露）

// 2) 在调用点拼装“Java风格”的消息体： file:line [func] - message
function wrapWithCaller(level) {
    const raw = base[level].bind(base);
    return (...args) => {
        const {functionName, file, line} = getCallerFrame();
        const loc = `${path.basename(file)}:${line}`;
        const fn = functionName && functionName !== 'anonymous' ? ` [${functionName}]` : '';
        // Java风格：<loc><func> - <message>
        const msg = args.map(a => (a instanceof Error && a.stack) ? a.stack : String(a)).join(' ');
        raw(`${loc}${fn} - ${msg}`);
    };
}

// 构造对外的 logger，方法：trace/debug/info/warn/error/fatal
const logger = {
    trace: wrapWithCaller('trace'),
    debug: wrapWithCaller('debug'),
    info: wrapWithCaller('info'),
    warn: wrapWithCaller('warn'),
    error: wrapWithCaller('error'),
    fatal: wrapWithCaller('fatal'),
};

// === 跨天自动切换新文件（无需重启） ===
setInterval(() => {
    const d = TODAY();
    if (d !== currentDate) {
        log4js.shutdown(() => {
            currentDate = d;
            configure(currentDate);
            // 记录一次换日
            logger.info('log rotated to new day');
        });
    }
}, 30 * 1000);

// === 捕获未处理异常 ===
process.on('uncaughtException', (err) => {
    logger.error('UncaughtException:', err && err.stack ? err.stack : String(err));
    // 按需：process.exit(1);
});
process.on('unhandledRejection', (reason) => {
    logger.error('UnhandledRejection:', reason instanceof Error ? reason.stack : String(reason));
});

// === 优雅退出：flush 缓冲再退出 ===
function gracefulExit(code = 0) {
    log4js.shutdown(() => process.exit(code));
}

process.on('SIGINT', () => gracefulExit(0));
process.on('SIGTERM', () => gracefulExit(0));
process.on('beforeExit', () => log4js.shutdown(() => {
}));

export default logger;
