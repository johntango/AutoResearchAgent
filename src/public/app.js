const form = document.getElementById('workflow-form');
const targetFileInput = document.getElementById('targetFile');
const submittedFileInput = document.getElementById('submittedFile');
const targetFileChip = document.getElementById('target-file-chip');
const submittedFileChip = document.getElementById('submitted-file-chip');
const targetPathInput = document.getElementById('targetPath');
const submittedPathInput = document.getElementById('submittedPath');
const runButton = document.getElementById('run-button');
const downloadButton = document.getElementById('download-button');
const refreshButton = document.getElementById('refresh-button');
const clearLogViewButton = document.getElementById('clear-log-view');
const healthBadge = document.getElementById('health-badge');
const runStateBadge = document.getElementById('run-state');
const workflowList = document.getElementById('workflow-list');
const workflowCount = document.getElementById('workflow-count');
const logView = document.getElementById('log-view');
const summaryView = document.getElementById('summary-view');
const artifactsView = document.getElementById('artifacts-view');
const traceView = document.getElementById('trace-view');

let logPollTimer = null;
let latestLogFingerprint = '';
let currentRunPromise = null;
let currentWorkflow = null;

const toJson = (value) => JSON.stringify(value, null, 2);

const updateFileChip = (element, file, fallbackText) => {
  if (file) {
    element.className = 'mt-2';
    element.innerHTML = `<span class="file-chip">${file.name}</span>`;
    return;
  }
  element.className = 'mt-2 text-secondary small';
  element.textContent = fallbackText;
};

const syncSelectedFileChips = () => {
  updateFileChip(targetFileChip, targetFileInput.files?.[0] || null, 'No target file selected.');
  updateFileChip(submittedFileChip, submittedFileInput.files?.[0] || null, 'No submitted file selected.');
};

const setRunState = (label, tone = 'light') => {
  runStateBadge.textContent = label;
  runStateBadge.className = `badge text-bg-${tone} status-pill`;
};

const setHealth = async () => {
  try {
    const response = await fetch('/api/health');
    if (!response.ok) throw new Error('Health endpoint unavailable');
    healthBadge.textContent = 'Healthy';
    healthBadge.className = 'badge text-bg-success status-pill';
  } catch {
    healthBadge.textContent = 'Offline';
    healthBadge.className = 'badge text-bg-danger status-pill';
  }
};

const renderWorkflows = (workflows) => {
  workflowCount.textContent = `${workflows.length} run${workflows.length === 1 ? '' : 's'}`;
  workflowList.innerHTML = '';

  if (!workflows.length) {
    const empty = document.createElement('div');
    empty.className = 'list-group-item text-secondary';
    empty.textContent = 'No workflows yet.';
    workflowList.appendChild(empty);
    return;
  }

  workflows
    .sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)))
    .forEach((workflow) => {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'list-group-item list-group-item-action workflow-list-item';
      item.innerHTML = `
        <div class="d-flex justify-content-between align-items-start gap-3">
          <div>
            <div class="fw-semibold">${workflow.runId}</div>
            <div class="small text-secondary"><code>${workflow.submittedPath}</code></div>
          </div>
          <span class="badge text-bg-${workflow.success ? 'success' : workflow.status === 'ESCALATED' ? 'danger' : 'secondary'}">${workflow.status}</span>
        </div>
      `;
      item.addEventListener('click', () => loadWorkflow(workflow.runId));
      workflowList.appendChild(item);
    });
};

const refreshWorkflowList = async () => {
  const response = await fetch('/api/workflows');
  const payload = await response.json();
  renderWorkflows(payload.workflows || []);
};

const renderWorkflow = (state) => {
  currentWorkflow = state;
  downloadButton.disabled = !state?.runId || !state?.files?.outputPath;
  summaryView.textContent = toJson({
    runId: state.runId,
    status: state.status,
    success: state.success,
    retries: state.retries,
    escalation: state.escalation,
    outputPath: state.files.outputPath,
  });

  artifactsView.textContent = toJson(state.artifacts);
  traceView.textContent = toJson({
    trace: state.trace,
    decisions: state.decisions,
    issues: state.issues,
  });
};

const loadWorkflow = async (runId) => {
  const response = await fetch(`/api/workflows/${encodeURIComponent(runId)}`);
  if (!response.ok) {
    throw new Error(`Unable to load workflow ${runId}`);
  }
  const state = await response.json();
  renderWorkflow(state);
  return state;
};

const pollLogs = async () => {
  try {
    const response = await fetch('/api/system/logs?limit=120');
    const payload = await response.json();
    const logs = payload.logs || [];
    const fingerprint = logs.map((entry) => `${entry.timestamp}:${entry.event}`).join('|');
    if (fingerprint === latestLogFingerprint) {
      return;
    }
    latestLogFingerprint = fingerprint;
    logView.textContent = logs.length ? logs.map((entry) => JSON.stringify(entry)).join('\n') : 'No logs yet.';
    logView.scrollTop = logView.scrollHeight;
  } catch (error) {
    logView.textContent = `Log polling failed: ${error.message}`;
  }
};

const ensureLogPolling = () => {
  if (logPollTimer) return;
  logPollTimer = window.setInterval(() => {
    pollLogs().catch(() => {});
  }, 1000);
};

const stopLogPolling = () => {
  if (!logPollTimer) return;
  window.clearInterval(logPollTimer);
  logPollTimer = null;
};

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (currentRunPromise) {
    return;
  }

  setRunState('Running', 'primary');
  runButton.disabled = true;
  downloadButton.disabled = true;
  latestLogFingerprint = '';
  ensureLogPolling();
  await pollLogs();

  const targetFile = targetFileInput.files?.[0] || null;
  const submittedFile = submittedFileInput.files?.[0] || null;

  if ((targetFile && !submittedFile) || (!targetFile && submittedFile)) {
    setRunState('Error', 'danger');
    summaryView.textContent = 'Choose both local DOCX files, or leave both blank and use paths.';
    runButton.disabled = false;
    return;
  }

  if (targetFile && submittedFile) {
    const formData = new FormData();
    formData.append('targetFile', targetFile);
    formData.append('submittedFile', submittedFile);
    currentRunPromise = fetch('/api/workflows/run', {
      method: 'POST',
      body: formData,
    });
  } else {
    currentRunPromise = fetch('/api/workflows/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        targetPath: targetPathInput.value.trim(),
        submittedPath: submittedPathInput.value.trim(),
      }),
    });
  }

  try {
    const response = await currentRunPromise;
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload?.error?.message || 'Workflow request failed');
    }
    setRunState(payload.status, payload.success ? 'success' : payload.status === 'ESCALATED' ? 'danger' : 'secondary');
    renderWorkflow(payload);
    await refreshWorkflowList();
    await pollLogs();
  } catch (error) {
    setRunState('Error', 'danger');
    summaryView.textContent = error.message;
  } finally {
    currentRunPromise = null;
    runButton.disabled = false;
  }
});

refreshButton.addEventListener('click', async () => {
  await Promise.all([refreshWorkflowList(), pollLogs(), setHealth()]);
});

downloadButton.addEventListener('click', () => {
  if (!currentWorkflow?.runId) {
    return;
  }
  window.open(`/api/workflows/${encodeURIComponent(currentWorkflow.runId)}/output`, '_blank');
});

targetFileInput.addEventListener('change', syncSelectedFileChips);
submittedFileInput.addEventListener('change', syncSelectedFileChips);

clearLogViewButton.addEventListener('click', () => {
  logView.textContent = 'Log view cleared.';
  latestLogFingerprint = '';
});

window.addEventListener('beforeunload', () => {
  stopLogPolling();
});

await Promise.all([setHealth(), refreshWorkflowList(), pollLogs()]);
syncSelectedFileChips();
ensureLogPolling();
setRunState('Idle', 'light');
