import { AGENT_NAME } from '../utils/constants.js';

export const exceptionHandler = async (state, reasons = []) => {
  const reviewItems = reasons.map((reason, index) => ({
    id: `review-${index + 1}`,
    reason,
    action: 'manual_review_required',
    createdAt: new Date().toISOString(),
  }));

  return {
    ok: true,
    agent: AGENT_NAME.EXCEPTION_HANDLER,
    confidence: 1,
    reviewItems,
    issues: reasons.map((reason) => ({
      category: 'invalid_input',
      severity: 'high',
      message: reason,
    })),
    inputSummary: {
      reasonCount: reasons.length,
    },
    outputSummary: {
      reviewItemCount: reviewItems.length,
    },
  };
};
