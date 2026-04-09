import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dataDir = path.resolve(__dirname, '../../data');

const ensureDir = async () => {
  await fs.mkdir(dataDir, { recursive: true });
};

const resolvePath = (name) => path.join(dataDir, name);

const readJson = async (name, fallback) => {
  await ensureDir();
  try {
    const file = await fs.readFile(resolvePath(name), 'utf8');
    return JSON.parse(file);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return fallback;
    }
    throw error;
  }
};

const writeJson = async (name, value) => {
  await ensureDir();
  await fs.writeFile(resolvePath(name), JSON.stringify(value, null, 2), 'utf8');
  return value;
};

export const createFileStore = () => ({
  readJson,
  writeJson,
  resolvePath,
});
