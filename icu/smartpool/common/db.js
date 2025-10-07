import path from 'path';
import {fileURLToPath} from 'url';
import {access, mkdir} from 'fs/promises';
import {Low} from 'lowdb';
import {JSONFile} from 'lowdb/node';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.resolve(__dirname, '..', 'data');
const DATA_FILE = path.join(DATA_DIR, 'latest.json');

const adapter = new JSONFile(DATA_FILE);
const defaultData = {};
const db = new Low(adapter, defaultData);

async function ensureDataDir() {
    await mkdir(DATA_DIR, {recursive: true});
}

async function fileExists() {
    try {
        await access(DATA_FILE);
        return true;
    } catch (err) {
        return false;
    }
}

export async function writeLatestBatch(batch) {
    await ensureDataDir();
    db.data = batch ?? {};
    await db.write();
    return db.data;
}

export async function readLatestBatch() {
    if (!await fileExists()) {
        const err = new Error('未找到批次数据');
        err.code = 'ENOENT';
        throw err;
    }
    await db.read();
    if (!db.data) {
        db.data = {};
    }
    return db.data;
}

export {DATA_FILE};
