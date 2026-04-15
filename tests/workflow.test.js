import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createSupervisor } from '../src/services/supervisor.js';

const createStore = () => {
  const map = new Map();
  return {
    save(state) {
      map.set(state.runId, structuredClone(state));
      return state;
    },
    get(runId) {
      const value = map.get(runId);
      return value ? structuredClone(value) : null;
    },
  };
};

const createFixturePaths = async (names) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'workflow-test-'));
  const files = {};

  for (const name of names) {
    const filePath = path.join(root, name);
    await fs.writeFile(filePath, `fixture for ${name}\n`, 'utf8');
    files[name] = filePath;
  }

  return { root, files };
};

test('successful workflow completes and writes artifacts', async () => {
  const { root, files } = await createFixturePaths(['target-success.docx', 'submitted-success.docx']);
  const supervisor = createSupervisor({ store: createStore(), outputRoot: path.join(root, 'output') });

  const state = await supervisor.runWorkflow({
    targetPath: files['target-success.docx'],
    submittedPath: files['submitted-success.docx'],
  });

  assert.equal(state.status, 'DONE');
  assert.equal(state.success, true);
  assert.ok(state.files.outputPath);
  assert.ok(state.files.outputPath.endsWith('.docx'));
  assert.ok(state.artifacts.templateProfile);
  assert.ok(state.artifacts.contentMap);
  assert.ok(state.artifacts.transformationPlan);
  assert.ok(state.artifacts.qaReport);
  assert.equal(state.artifacts.qaReport.passed, true);
  assert.equal(state.artifacts.rebuildSummary.strategy, 'submitted_docx_copy_artifact');
  assert.deepEqual(state.artifacts.contentMap.tables, []);
  assert.deepEqual(state.artifacts.contentMap.figures, []);
  assert.ok(state.artifacts.rebuildSummary.orderedBlocks.filter((block) => block.type === 'section').every((block) => block.headingStyle === 'Heading1'));
  assert.ok(state.artifacts.rebuildSummary.orderedBlocks.every((block) => !['list', 'table', 'figure'].includes(block.type)));
});

test('optional target structures do not become missing-content errors', async () => {
  const { root, files } = await createFixturePaths(['target-figures-tables-lists.docx', 'submitted-success.docx']);
  const supervisor = createSupervisor({ store: createStore(), outputRoot: path.join(root, 'output') });

  const state = await supervisor.runWorkflow({
    targetPath: files['target-figures-tables-lists.docx'],
    submittedPath: files['submitted-success.docx'],
  });

  assert.equal(state.status, 'DONE');
  assert.equal(state.success, true);
  assert.deepEqual(state.artifacts.contentMap.lists, []);
  assert.deepEqual(state.artifacts.contentMap.tables, []);
  assert.deepEqual(state.artifacts.contentMap.figures, []);
  assert.ok(state.issues.every((issue) => !/list|table|figure/i.test(issue.message)));
});

test('prototype placeholder artifact does not trigger fatal QA failure', async () => {
  const { root, files } = await createFixturePaths(['target-success.docx', 'submitted-success.docx']);
  const supervisor = createSupervisor({ store: createStore(), outputRoot: path.join(root, 'output') });

  const state = await supervisor.runWorkflow({
    targetPath: files['target-success.docx'],
    submittedPath: files['submitted-success.docx'],
  });

  assert.equal(state.status, 'DONE');
  assert.ok(state.trace.some((entry) => entry.agent === 'qaValidator' && entry.issues.length === 0));
  assert.ok(state.files.outputPath.endsWith('outputFormatted.docx'));
  assert.ok(state.issues.every((issue) => !/placeholder|real rebuilt docx|required output artifact/i.test(issue.message)));
});

test('plan validation failure loops back to source analyzer before escalating', async () => {
  const { root, files } = await createFixturePaths(['target-success.docx', 'submitted-missing-abstract-missing-references.docx']);
  const supervisor = createSupervisor({ store: createStore(), outputRoot: path.join(root, 'output') });

  const state = await supervisor.runWorkflow({
    targetPath: files['target-success.docx'],
    submittedPath: files['submitted-missing-abstract-missing-references.docx'],
  });

  const decisions = state.decisions.map((entry) => entry.decision);
  assert.ok(decisions.includes('planValidator'));
  assert.ok(decisions.filter((entry) => entry === 'sourceAnalyzer').length >= 2);
  assert.equal(state.status, 'ESCALATED');
});

test('qa failure enters repair loop and succeeds after repair', async () => {
  const { root, files } = await createFixturePaths(['target-success.docx', 'submitted-qa-fail.docx']);
  const supervisor = createSupervisor({ store: createStore(), outputRoot: path.join(root, 'output') });

  const state = await supervisor.runWorkflow({
    targetPath: files['target-success.docx'],
    submittedPath: files['submitted-qa-fail.docx'],
  });

  const decisions = state.decisions.map((entry) => entry.decision);
  assert.ok(decisions.includes('repairAgent'));
  assert.ok(decisions.filter((entry) => entry === 'documentRebuilder').length >= 2);
  assert.equal(state.status, 'DONE');
  assert.equal(state.success, true);
});

test('ambiguous input escalates after retries are exhausted', async () => {
  const { root, files } = await createFixturePaths(['target-success.docx', 'submitted-ambiguous-escalate.docx']);
  const supervisor = createSupervisor({ store: createStore(), outputRoot: path.join(root, 'output') });

  const state = await supervisor.runWorkflow({
    targetPath: files['target-success.docx'],
    submittedPath: files['submitted-ambiguous-escalate.docx'],
  });

  assert.equal(state.status, 'ESCALATED');
  assert.equal(state.success, false);
  assert.equal(state.escalation.required, true);
  assert.ok(state.artifacts.reviewItems.length > 0);
});
