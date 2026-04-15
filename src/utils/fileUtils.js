import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

export const pathExists = async (filePath) => {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
};

export const ensureDir = async (dirPath) => {
  await fs.mkdir(dirPath, { recursive: true });
  return dirPath;
};

export const assertReadableFile = async (filePath, label) => {
  if (!filePath || typeof filePath !== 'string') {
    const error = new Error(`${label} path is required.`);
    error.statusCode = 400;
    throw error;
  }

  try {
    const stat = await fs.stat(filePath);
    if (!stat.isFile()) {
      const error = new Error(`${label} must be a file.`);
      error.statusCode = 400;
      throw error;
    }
  } catch (error) {
    if (error.statusCode) {
      throw error;
    }
    const missing = new Error(`${label} file not found: ${filePath}`);
    missing.statusCode = 400;
    throw missing;
  }
};

export const readFileMetadata = async (filePath) => {
  const stat = await fs.stat(filePath);
  return {
    path: filePath,
    name: path.basename(filePath),
    extension: path.extname(filePath).toLowerCase(),
    sizeBytes: stat.size,
    modifiedAt: stat.mtime.toISOString(),
  };
};

export const writeJson = async (filePath, data) => {
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  return filePath;
};

export const writeText = async (filePath, text) => {
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, text, 'utf8');
  return filePath;
};

export const copyFile = async (sourcePath, destinationPath) => {
  await ensureDir(path.dirname(destinationPath));
  await fs.copyFile(sourcePath, destinationPath);
  return destinationPath;
};

const sanitizeFileName = (fileName) => String(fileName || 'upload.docx')
  .replace(/[^a-zA-Z0-9._-]+/g, '_')
  .replace(/^_+|_+$/g, '');

export const persistUploadedFile = async ({ rootDir, originalName, buffer }) => {
  const safeName = sanitizeFileName(originalName || 'upload.docx') || 'upload.docx';
  const filePath = path.join(rootDir, `${crypto.randomBytes(6).toString('hex')}_${safeName}`);
  await ensureDir(rootDir);
  await fs.writeFile(filePath, buffer);
  return filePath;
};

export const resolveOutputDir = (baseDir, runId) => path.join(baseDir, runId);
