import test from 'node:test';
import assert from 'node:assert/strict';
import { reconcileFormattingSummary } from '../src/agents/documentRebuilder.js';

test('reconcileFormattingSummary removes unsupported classifier roles and aligns counts to content map', () => {
  const formattingSummary = {
    mode: 'document_structure_style_overlay',
    formattedParagraphCount: 22,
    roleCounts: {
      title: 1,
      author: 1,
      affiliation: 1,
      email: 1,
      abstract: 1,
      keywords: 1,
      heading1: 2,
      heading2: 4,
      bulletList: 2,
      referencesHeading: 1,
      referenceItem: 14,
    },
    targetExemplarStyles: {
      title: 'papertitle',
      heading1: 'heading1',
      heading2: 'heading2',
      bulletList: 'bulletitem',
      referencesHeading: 'heading2',
      referenceItem: 'referenceitem',
      email: 'e-mail',
    },
  };

  const contentMap = {
    title: 'Example',
    authors: ['Dana Lee', 'Jordan Patel'],
    affiliations: ['Prototype Systems Lab'],
    abstract: 'Abstract text',
    keywords: ['document reformatting'],
    sections: [
      { id: 'sec-1', level: 1 },
      { id: 'sec-1-1', level: 2 },
    ],
    lists: [],
    tables: [],
    figures: [],
    references: ['Reference A', 'Reference B', 'Reference C'],
  };

  const plan = {
    headingPolicy: {
      styleNames: ['Heading1', 'Heading2'],
    },
    referencePolicy: {
      style: 'References',
    },
  };

  const reconciled = reconcileFormattingSummary({ formattingSummary, contentMap, plan });

  assert.deepEqual(reconciled.roleCounts, {
    title: 1,
    author: 1,
    affiliation: 1,
    abstract: 1,
    keywords: 1,
    heading1: 1,
    heading2: 1,
    referencesHeading: 1,
    referenceItem: 3,
  });
  assert.equal(reconciled.formattedParagraphCount, 11);
  assert.equal(reconciled.targetExemplarStyles.referencesHeading, 'References');
  assert.equal(reconciled.targetExemplarStyles.heading1, 'Heading1');
  assert.equal(reconciled.targetExemplarStyles.heading2, 'Heading2');
  assert.equal('bulletList' in reconciled.targetExemplarStyles, false);
  assert.equal('email' in reconciled.targetExemplarStyles, false);
});

test('reconcileFormattingSummary leaves non-overlay summaries unchanged', () => {
  const formattingSummary = {
    mode: 'copy_only',
    formattedParagraphCount: 0,
  };

  assert.equal(reconcileFormattingSummary({ formattingSummary }), formattingSummary);
});