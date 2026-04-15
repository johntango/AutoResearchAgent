import path from 'node:path';
import os from 'node:os';
import { persistUploadedFile } from '../utils/fileUtils.js';
import { pathExists } from '../utils/fileUtils.js';

const resolveInputPath = (value) => (path.isAbsolute(value) ? value : path.resolve(process.cwd(), value));
const uploadRoot = path.join(os.tmpdir(), 'document-reformatting-agent-prototype');

export const createWorkflowController = ({ supervisor, store }) => ({
  runWorkflow: async (req, res, next) => {
    try {
      const { targetPath, submittedPath } = req.body || {};
      const targetUpload = req.files?.targetFile?.[0] || null;
      const submittedUpload = req.files?.submittedFile?.[0] || null;

      if (!targetPath && !submittedPath && (!targetUpload || !submittedUpload)) {
        const error = new Error('targetPath and submittedPath are required.');
        error.statusCode = 400;
        throw error;
      }

      let resolvedTargetPath = targetPath ? resolveInputPath(targetPath) : null;
      let resolvedSubmittedPath = submittedPath ? resolveInputPath(submittedPath) : null;

      if (targetUpload) {
        resolvedTargetPath = await persistUploadedFile({
          rootDir: path.join(uploadRoot, 'target'),
          originalName: targetUpload.originalname,
          buffer: targetUpload.buffer,
        });
      }

      if (submittedUpload) {
        resolvedSubmittedPath = await persistUploadedFile({
          rootDir: path.join(uploadRoot, 'submitted'),
          originalName: submittedUpload.originalname,
          buffer: submittedUpload.buffer,
        });
      }

      if (!resolvedTargetPath || !resolvedSubmittedPath) {
        const error = new Error('Both target and submitted inputs are required, either as files or paths.');
        error.statusCode = 400;
        throw error;
      }

      const state = await supervisor.runWorkflow({
        targetPath: resolvedTargetPath,
        submittedPath: resolvedSubmittedPath,
      });
      res.json(state);
    } catch (error) {
      next(error);
    }
  },

  listWorkflows: (_req, res, next) => {
    try {
      const workflows = store.list().map((state) => ({
        runId: state.runId,
        status: state.status,
        success: state.success,
        targetPath: state.files.targetPath,
        submittedPath: state.files.submittedPath,
        outputPath: state.files.outputPath,
        updatedAt: state.metadata.updatedAt,
      }));
      res.json({ workflows });
    } catch (error) {
      next(error);
    }
  },

  getWorkflow: (req, res, next) => {
    try {
      const workflow = store.get(req.params.runId);
      if (!workflow) {
        const error = new Error('Workflow not found.');
        error.statusCode = 404;
        throw error;
      }
      res.json(workflow);
    } catch (error) {
      next(error);
    }
  },

  getTrace: (req, res, next) => {
    try {
      const workflow = store.get(req.params.runId);
      if (!workflow) {
        const error = new Error('Workflow not found.');
        error.statusCode = 404;
        throw error;
      }
      res.json({ runId: workflow.runId, trace: workflow.trace, decisions: workflow.decisions });
    } catch (error) {
      next(error);
    }
  },

  downloadOutput: async (req, res, next) => {
    try {
      const workflow = store.get(req.params.runId);
      if (!workflow) {
        const error = new Error('Workflow not found.');
        error.statusCode = 404;
        throw error;
      }

      const outputPath = workflow.files.outputPath;
      if (!outputPath || !(await pathExists(outputPath))) {
        const error = new Error('Workflow output is not available for download.');
        error.statusCode = 404;
        throw error;
      }

      res.download(outputPath, path.basename(outputPath));
    } catch (error) {
      next(error);
    }
  },
});
