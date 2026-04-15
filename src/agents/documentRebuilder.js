import path from 'node:path';
import { AGENT_NAME, ISSUE_CATEGORY, ISSUE_SEVERITY, OUTPUT_FILENAMES } from '../utils/constants.js';
import { copyFile, ensureDir, pathExists, writeJson } from '../utils/fileUtils.js';
import { rewriteDocxWithTargetStyleOverlay } from '../utils/docxStyleOverlay.js';

const buildOrderedBlocks = (contentMap, plan) => {
  const headingStyles = plan.headingPolicy?.styleNames || ['Heading1', 'Heading2'];
  const sectionBlocks = (contentMap.sections || []).map((section) => ({
    type: 'section',
    id: section.id,
    title: section.title,
    headingStyle: headingStyles[Math.max(0, Math.min((section.level || 1) - 1, headingStyles.length - 1))],
    blockCount: section.blocks,
  }));
  const listBlocks = (contentMap.lists || []).map((list) => ({
    type: 'list',
    id: list.id,
    style: list.style,
    itemCount: Array.isArray(list.items) ? list.items.length : 0,
  }));
  const tableBlocks = (contentMap.tables || []).map((table) => ({
    type: 'table',
    id: table.id,
    caption: table.caption,
    captionPosition: plan.captionPolicy.tables,
  }));
  const figureBlocks = (contentMap.figures || []).map((figure) => ({
    type: 'figure',
    id: figure.id,
    caption: figure.caption,
    captionPosition: plan.captionPolicy.figures,
  }));

  return [
    { type: 'title', value: contentMap.title },
    { type: 'authors', value: contentMap.authors },
    { type: 'affiliations', value: contentMap.affiliations },
    { type: 'abstract', value: contentMap.abstract },
    { type: 'keywords', value: contentMap.keywords },
    ...sectionBlocks,
    ...listBlocks,
    ...tableBlocks,
    ...figureBlocks,
    { type: 'references', value: contentMap.references },
  ];
};

const countSectionsByLevel = (sections = [], level) => sections.filter((section) => (section.level || 1) === level).length;

const summarizeSupportedRoleCounts = (contentMap = {}) => {
  const bulletLists = (contentMap.lists || []).filter((list) => `${list.style || ''}`.toLowerCase() === 'bullet').length;
  const numberedLists = Math.max(0, (contentMap.lists || []).length - bulletLists);

  return {
    ...(contentMap.title ? { title: 1 } : {}),
    ...((contentMap.authors || []).length > 0 ? { author: 1 } : {}),
    ...((contentMap.affiliations || []).length > 0 ? { affiliation: 1 } : {}),
    ...(contentMap.abstract ? { abstract: 1 } : {}),
    ...((contentMap.keywords || []).length > 0 ? { keywords: 1 } : {}),
    ...(countSectionsByLevel(contentMap.sections, 1) > 0 ? { heading1: countSectionsByLevel(contentMap.sections, 1) } : {}),
    ...(countSectionsByLevel(contentMap.sections, 2) > 0 ? { heading2: countSectionsByLevel(contentMap.sections, 2) } : {}),
    ...(bulletLists > 0 ? { bulletList: bulletLists } : {}),
    ...(numberedLists > 0 ? { numberedList: numberedLists } : {}),
    ...((contentMap.tables || []).length > 0 ? { tableCaption: contentMap.tables.length } : {}),
    ...((contentMap.figures || []).length > 0 ? { figureCaption: contentMap.figures.length } : {}),
    ...((contentMap.references || []).length > 0
      ? {
        referencesHeading: 1,
        referenceItem: contentMap.references.length,
      }
      : {}),
  };
};

const normalizeTargetExemplarStyles = ({ targetExemplarStyles = {}, contentMap = {}, plan = {} }) => {
  const normalized = { ...targetExemplarStyles };

  if (!(contentMap.lists || []).length) {
    delete normalized.bulletList;
    delete normalized.numberedList;
  }

  if (!(contentMap.tables || []).length) {
    delete normalized.tableCaption;
  }

  if (!(contentMap.figures || []).length) {
    delete normalized.figureCaption;
  }

  delete normalized.email;

  if (!(contentMap.references || []).length) {
    delete normalized.referencesHeading;
    delete normalized.referenceItem;
    delete normalized.bottomHeading;
  } else {
    normalized.referencesHeading = plan.referencePolicy?.style || 'References';
  }

  if (plan.headingPolicy?.styleNames?.[0]) {
    normalized.heading1 = plan.headingPolicy.styleNames[0];
  }

  if (plan.headingPolicy?.styleNames?.[1]) {
    normalized.heading2 = plan.headingPolicy.styleNames[1];
  }

  return normalized;
};

export const reconcileFormattingSummary = ({ formattingSummary = {}, contentMap = {}, plan = {} }) => {
  if (!formattingSummary || typeof formattingSummary !== 'object') {
    return formattingSummary;
  }

  if (formattingSummary.mode !== 'document_structure_style_overlay') {
    return formattingSummary;
  }

  const roleCounts = summarizeSupportedRoleCounts(contentMap);

  return {
    ...formattingSummary,
    formattedParagraphCount: Object.values(roleCounts).reduce((sum, count) => sum + count, 0),
    roleCounts,
    targetExemplarStyles: normalizeTargetExemplarStyles({
      targetExemplarStyles: formattingSummary.targetExemplarStyles,
      contentMap,
      plan,
    }),
  };
};

export const documentRebuilder = async (state) => {
  const outputDir = state.files.outputDir;
  const plan = state.artifacts.transformationPlan;
  const contentMap = state.artifacts.contentMap;
  const issues = [];

  if (!plan || !contentMap) {
    return {
      ok: false,
      agent: AGENT_NAME.DOCUMENT_REBUILDER,
      confidence: 0,
      outputPath: null,
      rebuildSummary: null,
      issues: [{
        category: ISSUE_CATEGORY.MISSING_ARTIFACT,
        severity: ISSUE_SEVERITY.CRITICAL,
        message: 'Cannot rebuild without content map and transformation plan.',
      }],
      inputSummary: {},
      outputSummary: {},
    };
  }

  await ensureDir(outputDir);
  const orderedBlocks = buildOrderedBlocks(contentMap, plan);
  let rebuildStrategy = 'submitted_docx_copy_artifact';
  let rebuildNotes = 'Prototype rebuild emits a real DOCX artifact by copying the submitted DOCX package to the workflow output path.';
  let outputArtifactSource = 'submitted_docx_copy';
  let formattingSummary = {
    mode: 'copy_only',
    formattedParagraphCount: 0,
  };
  const rebuildSummary = {
    strategy: rebuildStrategy,
    notes: rebuildNotes,
    orderedBlocks,
    styleOverlay: {
      headingPolicy: plan.headingPolicy,
      captionPolicy: plan.captionPolicy,
      referencePolicy: plan.referencePolicy,
    },
    outputArtifact: {
      kind: 'docx',
      source: outputArtifactSource,
      fileName: OUTPUT_FILENAMES.REBUILT_DOCX,
    },
    formattingSummary,
    repairHistory: plan.repairHistory || [],
  };

  const artifactPath = path.join(outputDir, OUTPUT_FILENAMES.REBUILT_ARTIFACT);
  const rebuiltDocPath = path.join(outputDir, OUTPUT_FILENAMES.REBUILT_DOCX);

  try {
    const overlayResult = await rewriteDocxWithTargetStyleOverlay({
      targetPath: state.files.targetPath,
      submittedPath: state.files.submittedPath,
      outputPath: rebuiltDocPath,
    });

    if (overlayResult.applied) {
      rebuildStrategy = 'target_style_overlay_docx';
      rebuildNotes = 'Rebuild emits a real DOCX artifact and overlays target paragraph, font, and spacing formatting across detected document structures while preserving submitted content.';
      outputArtifactSource = overlayResult.mode;
      formattingSummary = reconcileFormattingSummary({
        formattingSummary: overlayResult.summary,
        contentMap,
        plan,
      });
    } else {
      await copyFile(state.files.submittedPath, rebuiltDocPath);
      formattingSummary = overlayResult.summary;
    }
  } catch (error) {
    await copyFile(state.files.submittedPath, rebuiltDocPath);
    formattingSummary = {
      mode: 'copy_fallback',
      formattedParagraphCount: 0,
      reason: error.message,
    };
  }

  rebuildSummary.strategy = rebuildStrategy;
  rebuildSummary.notes = rebuildNotes;
  rebuildSummary.outputArtifact.source = outputArtifactSource;
  rebuildSummary.formattingSummary = formattingSummary;

  await writeJson(artifactPath, rebuildSummary);

  if (!(await pathExists(artifactPath))) {
    issues.push({
      category: ISSUE_CATEGORY.MISSING_ARTIFACT,
      severity: ISSUE_SEVERITY.HIGH,
      message: 'Rebuild artifact was not written successfully.',
    });
  }

  if (!(await pathExists(rebuiltDocPath))) {
    issues.push({
      category: ISSUE_CATEGORY.MISSING_ARTIFACT,
      severity: ISSUE_SEVERITY.HIGH,
      message: 'Rebuilt DOCX artifact was not written successfully.',
    });
  }

  const confidence = issues.length === 0 ? 0.86 : 0.52;

  return {
    ok: issues.length === 0,
    agent: AGENT_NAME.DOCUMENT_REBUILDER,
    confidence,
    outputPath: rebuiltDocPath,
    rebuildSummary,
    issues,
    inputSummary: {
      outputDir,
      repairCount: (plan.repairHistory || []).length,
    },
    outputSummary: {
      outputPath: rebuiltDocPath,
      orderedBlockCount: orderedBlocks.length,
    },
  };
};
