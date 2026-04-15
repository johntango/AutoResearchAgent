import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSupervisor } from '../src/services/supervisor.js';
import { stateStore } from '../src/services/stateStore.js';
import { ensureDir, writeText, writeJson } from '../src/utils/fileUtils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const fixtureDir = path.join(rootDir, 'examples', 'fixtures');
const outputRoot = path.join(rootDir, 'src', 'output');

const createFixture = async (fileName) => {
  const filePath = path.join(fixtureDir, fileName);
  await writeText(filePath, `Prototype fixture for ${fileName}\n`);
  return filePath;
};

const main = async () => {
  await ensureDir(fixtureDir);
  const supervisor = createSupervisor({ store: stateStore, outputRoot });

  const successState = await supervisor.runWorkflow({
    targetPath: await createFixture('target-success.docx'),
    submittedPath: await createFixture('submitted-success.docx'),
  });

  const escalatedState = await supervisor.runWorkflow({
    targetPath: await createFixture('target-success.docx'),
    submittedPath: await createFixture('submitted-ambiguous-missing-abstract-missing-references-escalate.docx'),
  });

  await writeJson(path.join(rootDir, 'examples', 'successful-workflow.json'), successState);
  await writeJson(path.join(rootDir, 'examples', 'escalated-workflow.json'), escalatedState);
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
