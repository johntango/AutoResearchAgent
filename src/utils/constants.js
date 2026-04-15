export const WORKFLOW_STATUS = {
  INIT: 'INIT',
  PROFILED: 'PROFILED',
  ANALYZED: 'ANALYZED',
  MAPPED: 'MAPPED',
  PLAN_INVALID: 'PLAN_INVALID',
  PLAN_VALID: 'PLAN_VALID',
  REBUILT: 'REBUILT',
  QA_FAILED: 'QA_FAILED',
  QA_PASSED: 'QA_PASSED',
  REPAIRING: 'REPAIRING',
  ESCALATED: 'ESCALATED',
  DONE: 'DONE',
};

export const ISSUE_CATEGORY = {
  SEMANTIC_STRUCTURE: 'semantic_structure',
  STYLE_LAYOUT: 'style_layout',
  MISSING_ARTIFACT: 'missing_artifact',
  INVALID_INPUT: 'invalid_input',
  AMBIGUOUS_CONTENT: 'ambiguous_content',
};

export const ISSUE_SEVERITY = {
  LOW: 'low',
  MEDIUM: 'medium',
  HIGH: 'high',
  CRITICAL: 'critical',
};

export const AGENT_NAME = {
  TEMPLATE_PROFILER: 'templateProfiler',
  SOURCE_ANALYZER: 'sourceAnalyzer',
  STRUCTURE_MAPPER: 'structureMapper',
  PLAN_VALIDATOR: 'planValidator',
  DOCUMENT_REBUILDER: 'documentRebuilder',
  QA_VALIDATOR: 'qaValidator',
  REPAIR_AGENT: 'repairAgent',
  EXCEPTION_HANDLER: 'exceptionHandler',
  SUPERVISOR: 'supervisor',
};

export const RETRY_LIMITS = {
  sourceAnalyzer: 2,
  structureMapper: 2,
  documentRebuilder: 2,
  repairAgent: 2,
};

export const CONFIDENCE_THRESHOLDS = {
  templateProfile: 0.7,
  sourceAnalysis: 0.7,
  structureMapping: 0.75,
  rebuild: 0.75,
  qa: 0.8,
};

export const OUTPUT_FILENAMES = {
  TEMPLATE_PROFILE: 'template_profile.json',
  CONTENT_MAP: 'content_map.json',
  TRANSFORMATION_PLAN: 'transformation_plan.json',
  QA_REPORT: 'qa_report.json',
  REVIEW_ITEMS: 'review_items.json',
  TRACE: 'trace.json',
  REBUILT_ARTIFACT: 'outputFormatted.json',
  REBUILT_DOCX: 'outputFormatted.docx',
};

export const FRONT_MATTER_ORDER = ['title', 'authors', 'affiliations', 'abstract', 'keywords'];

export const REQUIRED_DOCUMENT_STRUCTURES = ['title', 'authors', 'affiliations', 'abstract', 'keywords', 'body', 'references'];

export const OPTIONAL_DOCUMENT_STRUCTURES = ['lists', 'tables', 'figures'];
