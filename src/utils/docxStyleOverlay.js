import fs from 'node:fs/promises';
import path from 'node:path';
import JSZip from 'jszip';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { ensureDir } from './fileUtils.js';

const parser = new DOMParser();
const serializer = new XMLSerializer();

const STYLE_ENTRY_PATHS = ['word/styles.xml', 'word/numbering.xml'];
const INSTITUTION_HINT_PATTERN = /(university|institute|college|laboratory|laboratories|school|department|centre|center|company|limited|inc\.?|corp\.?|llc|gmbh|ltd\.?|massachusetts|cambridge|usa|uk|france|germany|china|india)/i;
const EMAIL_PATTERN = /@/;
const EMAIL_ADDRESS_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const NUMBERED_HEADING_PATTERN = /^\d+(?:\.\d+)+\s*\S+/;
const HEADING_PATTERN = /^([0-9]+[.)]\s*)?[A-Z][^.!?]{0,120}$/;
const TABLE_CAPTION_PATTERN = /^table\s+\d+\b/i;
const FIGURE_CAPTION_PATTERN = /^(fig\.?|figure)\s+\d+\b/i;
const REFERENCES_PATTERN = /^references?\b/i;
const KEYWORDS_PATTERN = /^keywords?\b/i;
const BULLET_MARKER_PATTERN = /^[\u2022\-*]\s+/;
const NUMBERED_LIST_PATTERN = /^([0-9]+[.)]|[a-z][.)]|[ivxlcdm]+[.)])\s+/i;
const HEADING_NUMBER_PREFIX_PATTERN = /^\s*(?:\d+(?:\.\d+)*[.)]?|[ivxlcdm]+[.)])\s*/i;
const BOTTOM_SECTION_HEADING_PATTERN = /^(references|appendix|appendices|notes?|acknowledg(?:e)?ments?)\b/i;
const CLIENT_ID_RUN_PATTERN = /^(<[^>]+>|\[[^\]]+\])$/;

const getChildren = (node) => Array.from(node?.childNodes || []).filter((child) => child.nodeType === 1);

const getFirstChildByName = (node, tagName) => getChildren(node).find((child) => child.tagName === tagName) || null;

const removeChildrenByName = (node, tagName) => {
  for (const child of getChildren(node).filter((entry) => entry.tagName === tagName)) {
    node.removeChild(child);
  }
};

const cloneIntoDocument = (node) => parser.parseFromString(serializer.serializeToString(node), 'text/xml').documentElement;

const getParagraphs = (doc) => Array.from(doc.getElementsByTagName('w:p'));

const getRunText = (run) => getChildren(run)
  .filter((child) => ['w:t', 'w:tab', 'w:br', 'w:cr'].includes(child.tagName))
  .map((child) => {
    if (child.tagName === 'w:tab') {
      return '\t';
    }

    if (child.tagName === 'w:br' || child.tagName === 'w:cr') {
      return '\n';
    }

    return child.textContent || '';
  })
  .join('');

const getParagraphText = (node) => getRunElements(node)
  .map((run) => getRunText(run))
  .join('')
  .replace(/\s+/g, ' ')
  .trim();

const getParagraphStyle = (paragraph) => paragraph.getElementsByTagName('w:pStyle')[0]?.getAttribute('w:val') || '';

const getStyleById = (stylesDocument, styleId) => {
  if (!stylesDocument || !styleId) {
    return null;
  }

  return Array.from(stylesDocument.getElementsByTagName('w:style')).find((node) => node.getAttribute('w:styleId') === styleId) || null;
};

const styleHasNumbering = (stylesDocument, styleId, visited = new Set()) => {
  if (!stylesDocument || !styleId || visited.has(styleId)) {
    return false;
  }

  visited.add(styleId);
  const styleNode = getStyleById(stylesDocument, styleId);
  if (!styleNode) {
    return false;
  }

  if (styleNode.getElementsByTagName('w:numPr').length > 0) {
    return true;
  }

  const basedOn = styleNode.getElementsByTagName('w:basedOn')[0]?.getAttribute('w:val') || '';
  return basedOn ? styleHasNumbering(stylesDocument, basedOn, visited) : false;
};

const getWordCount = (text) => text.trim() ? text.trim().split(/\s+/).length : 0;

const getRunElements = (paragraph) => Array.from(paragraph.getElementsByTagName('w:r'));

const getNormalizedRunText = (run) => getRunText(run).replace(/\s+/g, '').trim();

const setRunText = (run, text) => {
  for (const node of getChildren(run).filter((child) => ['w:t', 'w:tab', 'w:br', 'w:cr'].includes(child.tagName))) {
    node.parentNode?.removeChild(node);
  }

  if (!text) {
    return;
  }

  const runProperties = getFirstChildByName(run, 'w:rPr');
  let insertionPoint = runProperties?.nextSibling || null;
  const parts = text.split(/(\t|\n)/);

  for (const part of parts) {
    if (!part) {
      continue;
    }

    let contentNode = null;
    if (part === '\t') {
      contentNode = parser.parseFromString('<w:tab xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"/>', 'text/xml').documentElement;
    } else if (part === '\n') {
      contentNode = parser.parseFromString('<w:br xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"/>', 'text/xml').documentElement;
    } else {
      contentNode = parser.parseFromString('<w:t xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"/>', 'text/xml').documentElement;
      contentNode.textContent = part;

      if (/^\s|\s$/.test(part)) {
        contentNode.setAttribute('xml:space', 'preserve');
      }
    }

    if (insertionPoint) {
      run.insertBefore(contentNode, insertionPoint);
    } else {
      run.appendChild(contentNode);
    }
  }
};

const replaceRunWithSegments = (run, segments, applySegmentFormatting) => {
  const parent = run.parentNode;
  if (!parent) {
    return;
  }

  const nonEmptySegments = segments.filter((segment) => segment.text);
  if (nonEmptySegments.length === 0) {
    parent.removeChild(run);
    return;
  }

  for (const segment of nonEmptySegments) {
    const segmentRun = cloneIntoDocument(run);
    setRunText(segmentRun, segment.text);
    applySegmentFormatting(segmentRun, segment.kind);
    parent.insertBefore(segmentRun, run);
  }

  parent.removeChild(run);
};

const splitParagraphRunsByCharacterKind = (paragraph, getKindAtIndex, applyKindFormatting) => {
  let offset = 0;

  for (const run of [...getRunElements(paragraph)]) {
    const text = getRunText(run);
    if (!text) {
      continue;
    }

    const segments = [];
    let currentKind = null;
    let currentText = '';

    for (let index = 0; index < text.length; index += 1) {
      const kind = getKindAtIndex(offset + index);
      const char = text[index];

      if (currentKind === null || kind === currentKind) {
        currentKind = kind;
        currentText += char;
        continue;
      }

      segments.push({ text: currentText, kind: currentKind });
      currentKind = kind;
      currentText = char;
    }

    if (currentText) {
      segments.push({ text: currentText, kind: currentKind });
    }

    replaceRunWithSegments(run, segments, applyKindFormatting);
    offset += text.length;
  }
};

const getRangesForMatches = (text, pattern) => {
  const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`;
  const matcher = new RegExp(pattern.source, flags);
  const ranges = [];

  for (const match of text.matchAll(matcher)) {
    const matchedText = match[0] || '';
    if (!matchedText || match.index == null) {
      continue;
    }

    ranges.push({ start: match.index, end: match.index + matchedText.length, kind: 'email' });
  }

  return ranges;
};

const getKindAtIndex = (ranges, index, defaultKind = 'base') => ranges.find((range) => index >= range.start && index < range.end)?.kind || defaultKind;

const getFirstRunWithText = (paragraph) => getRunElements(paragraph).find((run) => getParagraphText(run).trim())
  || getRunElements(paragraph)[0]
  || null;

const getParagraphInfo = (paragraph, index) => ({
  index,
  paragraph,
  text: getParagraphText(paragraph),
  style: getParagraphStyle(paragraph),
});

const BODY_FIRST_ROLE = 'bodyFirstAfterHeading';
const BODY_CONTINUATION_ROLE = 'bodyIndented';
const DOCUMENT_ZONE = {
  TOP: 'top',
  BODY: 'body',
  BOTTOM: 'bottom',
};

const isBlankParagraph = (info) => !info.text;

const isLikelyAffiliation = (text) => /^\d+\s+/.test(text) || EMAIL_PATTERN.test(text) || INSTITUTION_HINT_PATTERN.test(text);

const isLikelyHeadingLevel2 = (info) => {
  if (!info.text) {
    return false;
  }

  return /^heading2$/i.test(info.style) || NUMBERED_HEADING_PATTERN.test(info.text);
};

const isLikelyHeadingLevel1 = (info, nextInfo) => {
  if (!info.text) {
    return false;
  }

  if (/^heading1$/i.test(info.style)) {
    return true;
  }

  if (REFERENCES_PATTERN.test(info.text) || KEYWORDS_PATTERN.test(info.text)) {
    return false;
  }

  if (!HEADING_PATTERN.test(info.text)) {
    return false;
  }

  if (NUMBERED_HEADING_PATTERN.test(info.text)) {
    return false;
  }

  if (isLikelyShortListCandidate(info)) {
    return false;
  }

  const wordCount = getWordCount(info.text);
  const nextWordCount = nextInfo ? getWordCount(nextInfo.text) : 0;

  return wordCount > 0 && wordCount <= 12 && nextWordCount >= 8;
};

const isLikelyShortListCandidate = (info) => {
  if (!info.text || /[:.!?]$/.test(info.text)) {
    return false;
  }

  const wordCount = getWordCount(info.text);
  return wordCount > 0 && wordCount <= 10;
};

const isLikelyListItem = (info, previousInfo, nextInfo) => {
  if (!info.text) {
    return false;
  }

  if (/bulletitem|numitem/i.test(info.style)) {
    return true;
  }

  if (BULLET_MARKER_PATTERN.test(info.text) || NUMBERED_LIST_PATTERN.test(info.text)) {
    return true;
  }

  if (!isLikelyShortListCandidate(info)) {
    return false;
  }

  return Boolean(
    (previousInfo && isLikelyShortListCandidate(previousInfo))
    || (nextInfo && isLikelyShortListCandidate(nextInfo)),
  );
};

const isTableCaption = (info) => TABLE_CAPTION_PATTERN.test(info.text) || /tablecaption/i.test(info.style);

const isFigureCaption = (info) => FIGURE_CAPTION_PATTERN.test(info.text) || /figurecaption/i.test(info.style);

const isReferencesHeading = (info) => REFERENCES_PATTERN.test(info.text);

const isBottomSectionHeading = (info) => BOTTOM_SECTION_HEADING_PATTERN.test(info.text);

const removeDescendantsByName = (node, tagName) => {
  for (const child of Array.from(node.getElementsByTagName(tagName))) {
    child.parentNode?.removeChild(child);
  }
};

const stripPrefixFromRunText = (paragraph, pattern) => {
  const fullText = getParagraphText(paragraph);
  const match = fullText.match(pattern);

  if (!match || !match[0]) {
    return false;
  }

  let remainingToStrip = match[0].length;

  for (const run of getRunElements(paragraph)) {
    if (remainingToStrip <= 0) {
      break;
    }

    const runText = getRunText(run);
    if (!runText) {
      continue;
    }

    if (remainingToStrip >= runText.length) {
      setRunText(run, '');
      remainingToStrip -= runText.length;
      continue;
    }

    setRunText(run, runText.slice(remainingToStrip));
    remainingToStrip = 0;
  }

  return true;
};

const normalizeParagraphProperties = (paragraphProperties) => {
  removeChildrenByName(paragraphProperties, 'w:numPr');
  removeDescendantsByName(paragraphProperties, 'w:numPr');
  return paragraphProperties;
};

const ensureParagraphProperties = (paragraph) => {
  let paragraphProperties = getFirstChildByName(paragraph, 'w:pPr');
  if (!paragraphProperties) {
    paragraphProperties = parser.parseFromString('<w:pPr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"/>', 'text/xml').documentElement;
    paragraph.insertBefore(paragraphProperties, paragraph.firstChild);
  }

  return paragraphProperties;
};

const clearParagraphIndentation = (paragraph) => {
  const paragraphProperties = ensureParagraphProperties(paragraph);
  removeChildrenByName(paragraphProperties, 'w:ind');
};

const setParagraphIndentation = (paragraph, attributes = {}) => {
  const paragraphProperties = ensureParagraphProperties(paragraph);
  removeChildrenByName(paragraphProperties, 'w:ind');

  const entries = Object.entries(attributes).filter(([, value]) => value != null);
  if (entries.length === 0) {
    return;
  }

  const indentation = parser.parseFromString('<w:ind xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"/>', 'text/xml').documentElement;
  for (const [name, value] of entries) {
    indentation.setAttribute(`w:${name}`, String(value));
  }

  paragraphProperties.appendChild(indentation);
};

const getParagraphIndentationAttributes = (paragraph) => {
  const indentation = paragraph.getElementsByTagName('w:ind')[0];
  if (!indentation) {
    return {};
  }

  return {
    left: indentation.getAttribute('w:left') || null,
    firstLine: indentation.getAttribute('w:firstLine') || null,
    hanging: indentation.getAttribute('w:hanging') || null,
  };
};

const getParagraphTabStops = (paragraph) => Array.from(paragraph.getElementsByTagName('w:tab')).map((tab) => ({
  val: tab.getAttribute('w:val') || 'left',
  pos: tab.getAttribute('w:pos') || null,
})).filter((tab) => tab.pos != null);

const toTwips = (value) => Number.parseInt(value || '0', 10) || 0;

const setParagraphTabStops = (paragraph, tabStops = []) => {
  const paragraphProperties = ensureParagraphProperties(paragraph);
  removeChildrenByName(paragraphProperties, 'w:tabs');

  if (!tabStops.length) {
    return;
  }

  const tabsNode = parser.parseFromString('<w:tabs xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"/>', 'text/xml').documentElement;
  for (const tabStop of tabStops) {
    const tabNode = parser.parseFromString('<w:tab xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"/>', 'text/xml').documentElement;
    tabNode.setAttribute('w:val', tabStop.val || 'left');
    tabNode.setAttribute('w:pos', String(tabStop.pos));
    tabsNode.appendChild(tabNode);
  }

  paragraphProperties.appendChild(tabsNode);
};

const getHeadingNumberGapTabStops = (paragraph, fallbackParagraph = null) => {
  const indentation = getParagraphIndentationAttributes(paragraph);
  const left = toTwips(indentation.left);
  const hanging = toTwips(indentation.hanging);
  const firstLine = toTwips(indentation.firstLine);
  const numberStart = indentation.hanging != null
    ? Math.max(0, left - hanging)
    : Math.max(0, left + firstLine);

  const paragraphTabs = getParagraphTabStops(paragraph)
    .map((tab) => ({ ...tab, pos: toTwips(tab.pos) }))
    .filter((tab) => tab.pos > numberStart)
    .sort((leftTab, rightTab) => leftTab.pos - rightTab.pos);

  const textStart = paragraphTabs[0]?.pos ?? left;
  const gap = Math.max(0, textStart - numberStart);

  if (gap > 0) {
    return [{ val: 'left', pos: gap }];
  }

  if (fallbackParagraph) {
    return getHeadingNumberGapTabStops(fallbackParagraph);
  }

  return [];
};

const clearParagraphStyle = (paragraph) => {
  const paragraphProperties = ensureParagraphProperties(paragraph);
  removeChildrenByName(paragraphProperties, 'w:pStyle');
};

const clearParagraphOutlineLevel = (paragraph) => {
  const paragraphProperties = ensureParagraphProperties(paragraph);
  removeChildrenByName(paragraphProperties, 'w:outlineLvl');
};

const setParagraphSpacingFromStyle = (paragraph, stylesDocument, styleId) => {
  const styleNode = getStyleById(stylesDocument, styleId);
  const styleSpacing = styleNode?.getElementsByTagName('w:spacing')[0] || null;
  if (!styleSpacing) {
    return;
  }

  const paragraphProperties = ensureParagraphProperties(paragraph);
  removeChildrenByName(paragraphProperties, 'w:spacing');
  paragraphProperties.appendChild(cloneIntoDocument(styleSpacing));
};

const setParagraphAlignmentFromStyle = (paragraph, stylesDocument, styleId) => {
  const styleNode = getStyleById(stylesDocument, styleId);
  const styleAlignment = styleNode?.getElementsByTagName('w:jc')[0] || null;
  if (!styleAlignment) {
    return;
  }

  const paragraphProperties = ensureParagraphProperties(paragraph);
  removeChildrenByName(paragraphProperties, 'w:jc');
  paragraphProperties.appendChild(cloneIntoDocument(styleAlignment));
};

const setRunPropertiesFromStyle = (paragraph, stylesDocument, styleId) => {
  const styleNode = getStyleById(stylesDocument, styleId);
  const styleRunProperties = styleNode?.getElementsByTagName('w:rPr')[0] || null;
  if (!styleRunProperties) {
    return;
  }

  for (const run of getRunElements(paragraph)) {
    removeChildrenByName(run, 'w:rPr');
    run.insertBefore(cloneIntoDocument(styleRunProperties), run.firstChild);
  }
};

const getParagraphSpacingBefore = (paragraph) => Number.parseInt(paragraph.getElementsByTagName('w:spacing')[0]?.getAttribute('w:before') || '0', 10) || 0;

const copyStyleEntries = async (targetZip, submittedZip) => {
  for (const entryPath of STYLE_ENTRY_PATHS) {
    const entry = targetZip.file(entryPath);
    if (!entry) {
      continue;
    }

    submittedZip.file(entryPath, await entry.async('nodebuffer'));
  }
};

const replaceParagraphProperties = (paragraph, sourceParagraph) => {
  const sourcePPr = getFirstChildByName(sourceParagraph, 'w:pPr');
  removeChildrenByName(paragraph, 'w:pPr');
  if (sourcePPr) {
    paragraph.insertBefore(normalizeParagraphProperties(cloneIntoDocument(sourcePPr)), paragraph.firstChild);
  }
};

const replaceRunProperties = (run, sourceRun) => {
  if (!run) {
    return;
  }

  const sourceRPr = sourceRun ? getFirstChildByName(sourceRun, 'w:rPr') : null;
  removeChildrenByName(run, 'w:rPr');
  if (sourceRPr) {
    run.insertBefore(cloneIntoDocument(sourceRPr), run.firstChild);
  }
};

const isEmailRun = (run) => EMAIL_ADDRESS_PATTERN.test(getRunText(run));

const isClientIdRun = (run) => CLIENT_ID_RUN_PATTERN.test(getNormalizedRunText(run));

const isClientIdStartRun = (run) => /^[<\[]/.test(getNormalizedRunText(run));

const isClientIdEndRun = (run) => /[>\]]$/.test(getNormalizedRunText(run));

const ensureRunProperties = (run) => {
  let runProperties = getFirstChildByName(run, 'w:rPr');
  if (!runProperties) {
    runProperties = parser.parseFromString('<w:rPr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"/>', 'text/xml').documentElement;
    run.insertBefore(runProperties, run.firstChild);
  }

  return runProperties;
};

const setRunVerticalAlign = (run, value) => {
  const runProperties = ensureRunProperties(run);
  removeChildrenByName(runProperties, 'w:vertAlign');

  if (!value) {
    return;
  }

  const vertAlign = parser.parseFromString(`<w:vertAlign xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" w:val="${value}"/>`, 'text/xml').documentElement;
  runProperties.appendChild(vertAlign);
};

const isSuperscriptMarkerRun = (run) => /^\d+[,*]*$/.test(getRunText(run).trim());

const getFirstMatchingSourceRun = (paragraph, predicate) => getRunElements(paragraph).find((run) => predicate(getRunText(run).trim(), run)) || null;

const getEmailSourceRun = (...paragraphs) => {
  for (const paragraph of paragraphs) {
    if (!paragraph) {
      continue;
    }

    const emailRun = getFirstMatchingSourceRun(paragraph, (_text, run) => isEmailRun(run));
    if (emailRun) {
      return emailRun;
    }
  }

  return null;
};

const getSuperscriptSourceRun = (...paragraphs) => {
  for (const paragraph of paragraphs) {
    if (!paragraph) {
      continue;
    }

    const superscriptRun = getFirstMatchingSourceRun(paragraph, (_text, run) => {
      const vertAlign = run.getElementsByTagName('w:vertAlign')[0]?.getAttribute('w:val') || '';
      return vertAlign === 'superscript' || isClientIdRun(run) || isSuperscriptMarkerRun(run);
    });

    if (superscriptRun) {
      return superscriptRun;
    }
  }

  return null;
};

const applyEmailRunFormatting = (paragraph, sourceParagraph, options = {}) => {
  const emailSourceRun = getEmailSourceRun(sourceParagraph, options.emailSourceParagraph);
  if (!emailSourceRun) {
    return;
  }

  const baseSourceRun = getFirstRunWithText(sourceParagraph) || emailSourceRun;
  const emailRanges = getRangesForMatches(getParagraphText(paragraph), EMAIL_ADDRESS_PATTERN);
  if (emailRanges.length === 0) {
    return;
  }

  splitParagraphRunsByCharacterKind(
    paragraph,
    (index) => getKindAtIndex(emailRanges, index),
    (run, kind) => {
      replaceRunProperties(run, kind === 'email' ? emailSourceRun : baseSourceRun);
    },
  );
};

const getAuthorSuperscriptRanges = (text) => {
  const ranges = [];

  for (let index = 0; index < text.length; index += 1) {
    if (!/\d/.test(text[index])) {
      continue;
    }

    let previousIndex = index - 1;
    while (previousIndex >= 0 && /\s/.test(text[previousIndex])) {
      previousIndex -= 1;
    }

    if (previousIndex < 0 || !/[A-Za-z.)\]]/.test(text[previousIndex])) {
      continue;
    }

    let markerEnd = index;
    while (markerEnd < text.length && /[\d,*]/.test(text[markerEnd])) {
      markerEnd += 1;
    }

    ranges.push({ start: index, end: markerEnd, kind: 'superscript' });

    let clientIdStart = markerEnd;
    while (clientIdStart < text.length && /\s/.test(text[clientIdStart])) {
      clientIdStart += 1;
    }

    if (clientIdStart >= text.length || !/[<\[]/.test(text[clientIdStart])) {
      index = markerEnd - 1;
      continue;
    }

    const closingChar = text[clientIdStart] === '<' ? '>' : ']';
    let clientIdEnd = clientIdStart + 1;
    while (clientIdEnd < text.length && text[clientIdEnd] !== closingChar) {
      clientIdEnd += 1;
    }

    if (clientIdEnd < text.length) {
      ranges.push({ start: markerEnd, end: clientIdEnd + 1, kind: 'superscript' });
      index = clientIdEnd;
      continue;
    }

    index = markerEnd - 1;
  }

  return ranges;
};

const applyClientIdSuperscriptFormatting = (paragraph, sourceParagraph, options = {}) => {
  const superscriptSourceRun = getSuperscriptSourceRun(sourceParagraph, options.superscriptSourceParagraph, options.emailSourceParagraph);
  const baseSourceRun = getFirstRunWithText(sourceParagraph) || superscriptSourceRun;
  const superscriptRanges = getAuthorSuperscriptRanges(getParagraphText(paragraph));
  if (superscriptRanges.length === 0) {
    return;
  }

  splitParagraphRunsByCharacterKind(
    paragraph,
    (index) => getKindAtIndex(superscriptRanges, index),
    (run, kind) => {
      const sourceRun = kind === 'superscript' ? (superscriptSourceRun || baseSourceRun) : baseSourceRun;
      replaceRunProperties(run, sourceRun);
      setRunVerticalAlign(run, kind === 'superscript' ? 'superscript' : null);
    },
  );
};

const applyInlineLabelParagraphFormatting = (paragraph, sourceParagraph, labelPattern) => {
  replaceParagraphProperties(paragraph, sourceParagraph);

  const labelSourceRun = getFirstMatchingSourceRun(sourceParagraph, (text) => labelPattern.test(text));
  const bodySourceRun = getFirstMatchingSourceRun(sourceParagraph, (text) => text && !labelPattern.test(text))
    || labelSourceRun
    || getFirstRunWithText(sourceParagraph);

  let labelAssigned = false;
  for (const run of getRunElements(paragraph)) {
    const text = getRunText(run).trim();
    if (!labelAssigned && labelPattern.test(text)) {
      replaceRunProperties(run, labelSourceRun || bodySourceRun);
      labelAssigned = true;
      continue;
    }

    replaceRunProperties(run, bodySourceRun);
  }
};

const applyAuthorParagraphFormatting = (paragraph, sourceParagraph, options = {}) => {
  applyParagraphFormatting(paragraph, sourceParagraph);
  applyClientIdSuperscriptFormatting(paragraph, sourceParagraph, options);
};

const applyAffiliationParagraphFormatting = (paragraph, sourceParagraph, options = {}) => {
  applyParagraphFormatting(paragraph, sourceParagraph);
  applyEmailRunFormatting(paragraph, sourceParagraph, options);
};

const applyEmailParagraphFormatting = (paragraph, sourceParagraph, options = {}) => {
  applyParagraphFormatting(paragraph, sourceParagraph);
  applyEmailRunFormatting(paragraph, sourceParagraph, options);
};

const applyHeadingParagraphFormatting = (paragraph, sourceParagraph, options = {}) => {
  applyParagraphFormatting(paragraph, sourceParagraph);

  if (options.role === 'heading2' && options.numberedHeadingRoles?.has('heading2')) {
    setParagraphIndentation(paragraph, { left: 0, firstLine: 0, hanging: 0 });
    setParagraphTabStops(
      paragraph,
      getHeadingNumberGapTabStops(
        options.headingNumberSpacingSourceParagraph || sourceParagraph,
        sourceParagraph,
      ),
    );
  }

  const styleId = getParagraphStyle(sourceParagraph);
  setParagraphSpacingFromStyle(paragraph, options.stylesDocument, styleId);
};

const applyBottomHeadingParagraphFormatting = (paragraph, sourceParagraph, options = {}) => {
  applyParagraphFormatting(paragraph, sourceParagraph);
  setParagraphIndentation(paragraph, { left: 0, firstLine: 0, hanging: 0 });
  clearParagraphStyle(paragraph);
  clearParagraphOutlineLevel(paragraph);

  const styleId = getParagraphStyle(sourceParagraph);
  setParagraphSpacingFromStyle(paragraph, options.stylesDocument, styleId);
  setParagraphAlignmentFromStyle(paragraph, options.stylesDocument, styleId);
  setRunPropertiesFromStyle(paragraph, options.stylesDocument, styleId);
};

const applyRoleFormatting = (role, paragraph, sourceParagraph, options = {}) => {
  if (!sourceParagraph) {
    return;
  }

  if ((role === 'heading1' || role === 'heading2') && options.numberedHeadingRoles?.has(role)) {
    stripPrefixFromRunText(paragraph, HEADING_NUMBER_PREFIX_PATTERN);
  }

  if (role === 'author') {
    applyAuthorParagraphFormatting(paragraph, sourceParagraph, options);
    return;
  }

  if (role === 'affiliation') {
    applyAffiliationParagraphFormatting(paragraph, sourceParagraph, options);
    return;
  }

  if (role === 'email') {
    applyEmailParagraphFormatting(paragraph, sourceParagraph, options);
    return;
  }

  if (role === 'referencesHeading' || role === 'bottomHeading') {
    applyBottomHeadingParagraphFormatting(paragraph, sourceParagraph, options);
    return;
  }

  if (role === 'heading1' || role === 'heading2' || role === 'heading3' || role === 'heading4' || role === 'referencesHeading') {
    applyHeadingParagraphFormatting(paragraph, sourceParagraph, { ...options, role });
    return;
  }

  if (role === 'abstract') {
    applyInlineLabelParagraphFormatting(paragraph, sourceParagraph, /^abstract[.:]?$/i);
    return;
  }

  applyParagraphFormatting(paragraph, sourceParagraph);
};

const applyParagraphFormatting = (paragraph, sourceParagraph) => {
  replaceParagraphProperties(paragraph, sourceParagraph);
  const sourceRun = getFirstRunWithText(sourceParagraph);
  for (const run of getRunElements(paragraph)) {
    replaceRunProperties(run, sourceRun);
  }
};

const ABSTRACT_HEADING_PATTERN = /^abstract[\s.:;-]*$/i;
const ABSTRACT_PREFIX_PATTERN = /^abstract\b/i;
const ABSTRACT_END_PATTERNS = [
  /^(keywords|index terms?)\b/i,
  /^([0-9]+[.)]\s*)?introduction\b/i,
  /^([ivx]+[.)]\s*)?introduction\b/i,
  /^references?\b/i,
];

const findAbstractHeadingIndex = (paragraphs) => {
  const exactMatch = paragraphs.findIndex((paragraph) => ABSTRACT_HEADING_PATTERN.test(getParagraphText(paragraph)));
  if (exactMatch >= 0) {
    return exactMatch;
  }

  return paragraphs.findIndex((paragraph) => ABSTRACT_PREFIX_PATTERN.test(getParagraphText(paragraph)));
};

const findAbstractBodyParagraphs = (paragraphs, headingIndex) => {
  if (headingIndex < 0) {
    return [];
  }

  const bodyParagraphs = [];
  for (let index = headingIndex + 1; index < paragraphs.length; index += 1) {
    const paragraph = paragraphs[index];
    const text = getParagraphText(paragraph);

    if (!text) {
      if (bodyParagraphs.length > 0) {
        break;
      }
      continue;
    }

    if (ABSTRACT_END_PATTERNS.some((pattern) => pattern.test(text))) {
      break;
    }

    if (bodyParagraphs.length > 0 && /^Heading/i.test(getParagraphStyle(paragraph))) {
      break;
    }

    bodyParagraphs.push(paragraph);

    if (bodyParagraphs.length >= 3) {
      break;
    }
  }

  return bodyParagraphs;
};

const findKeywordIndex = (paragraphInfos) => paragraphInfos.findIndex((info) => KEYWORDS_PATTERN.test(info.text));

const findReferenceHeadingIndex = (paragraphInfos) => paragraphInfos.findIndex((info) => isReferencesHeading(info));

const getAbstractRange = (paragraphInfos) => {
  const headingIndex = findAbstractHeadingIndex(paragraphInfos.map((info) => info.paragraph));

  if (headingIndex < 0) {
    return { start: -1, end: -1 };
  }

  const bodyParagraphs = findAbstractBodyParagraphs(paragraphInfos.map((info) => info.paragraph), headingIndex);
  const end = bodyParagraphs.length > 0 ? paragraphInfos.findIndex((info) => info.paragraph === bodyParagraphs.at(-1)) : headingIndex;
  return { start: headingIndex, end: Math.max(headingIndex, end) };
};

const findFirstMatch = (paragraphInfos, predicate) => paragraphInfos.find((info) => predicate(info))?.paragraph || null;

const getBodyRange = (paragraphInfos, abstractRange, keywordIndex, referenceIndex) => {
  const start = keywordIndex >= 0 ? keywordIndex + 1 : (abstractRange.end >= 0 ? abstractRange.end + 1 : 0);
  const end = referenceIndex >= 0 ? referenceIndex - 1 : paragraphInfos.length - 1;
  return { start, end };
};

const buildDocumentZones = (paragraphInfos) => {
  const firstHeading1Index = paragraphInfos.findIndex((info) => /^heading1$/i.test(info.style) || isLikelyHeadingLevel1(info, null));
  const referenceIndex = findReferenceHeadingIndex(paragraphInfos);

  return paragraphInfos.map((info, index) => {
    if (referenceIndex >= 0 && index >= referenceIndex) {
      return DOCUMENT_ZONE.BOTTOM;
    }

    if (firstHeading1Index >= 0 && index >= firstHeading1Index) {
      return DOCUMENT_ZONE.BODY;
    }

    return DOCUMENT_ZONE.TOP;
  });
};

const findRepresentativeHeadingParagraph = (classifiedRoles, headingRole, preferredStylePattern) => {
  const styledCandidates = classifiedRoles.filter((entry) => entry.role === headingRole && preferredStylePattern.test(entry.info.style));
  const spacedCandidates = styledCandidates.filter((entry) => getParagraphSpacingBefore(entry.info.paragraph) > 0);

  for (const candidate of spacedCandidates) {
    const originalIndex = classifiedRoles.indexOf(candidate);
    const previousRole = classifiedRoles.slice(0, originalIndex).reverse().find((entry) => entry.role !== 'blank')?.role || null;
    if (previousRole && !['heading1', 'heading2', 'heading3', 'heading4'].includes(previousRole)) {
      return candidate.info.paragraph;
    }
  }

  if (spacedCandidates.length > 0) {
    return spacedCandidates[0].info.paragraph;
  }

  for (let index = 0; index < styledCandidates.length; index += 1) {
    const candidate = styledCandidates[index];
    const originalIndex = classifiedRoles.indexOf(candidate);
    const previousRole = classifiedRoles.slice(0, originalIndex).reverse().find((entry) => entry.role !== 'blank')?.role || null;
    if (previousRole && !['heading1', 'heading2', 'heading3', 'heading4'].includes(previousRole)) {
      return candidate.info.paragraph;
    }
  }

  if (styledCandidates.length > 0) {
    return styledCandidates[0].info.paragraph;
  }

  return null;
};

const buildTargetExemplars = (paragraphInfos) => {
  const abstractRange = getAbstractRange(paragraphInfos);
  const keywordIndex = findKeywordIndex(paragraphInfos);
  const referenceIndex = findReferenceHeadingIndex(paragraphInfos);
  const bodyRange = getBodyRange(paragraphInfos, abstractRange, keywordIndex, referenceIndex);
  const bodyInfos = paragraphInfos.slice(Math.max(0, bodyRange.start), Math.max(bodyRange.start, bodyRange.end + 1));
  const targetClassification = classifySubmittedParagraphs(paragraphInfos);
  const zones = buildDocumentZones(paragraphInfos);
  const targetBodyFirst = targetClassification.roles.find(({ role }) => role === BODY_FIRST_ROLE)?.info.paragraph || null;
  const targetBodyIndented = targetClassification.roles.find(({ role }) => role === BODY_CONTINUATION_ROLE)?.info.paragraph || null;
  const representativeHeading1 = findRepresentativeHeadingParagraph(targetClassification.roles, 'heading1', /^heading1$/i);
  const representativeHeading2 = findRepresentativeHeadingParagraph(targetClassification.roles, 'heading2', /^heading2$/i);
  const representativeBottomHeading = paragraphInfos.find((info, index) => zones[index] === DOCUMENT_ZONE.BOTTOM && isBottomSectionHeading(info))?.paragraph || null;

  return {
    title: paragraphInfos[0]?.paragraph || null,
    author: findFirstMatch(paragraphInfos, (info) => /^author$/i.test(info.style)) || paragraphInfos[1]?.paragraph || null,
    affiliation: findFirstMatch(paragraphInfos, (info) => /^address$/i.test(info.style) || isLikelyAffiliation(info.text)) || null,
    email: findFirstMatch(paragraphInfos, (info) => EMAIL_ADDRESS_PATTERN.test(info.text)) || null,
    abstract: abstractRange.start >= 0 ? paragraphInfos[abstractRange.start].paragraph : null,
    keywords: keywordIndex >= 0 ? paragraphInfos[keywordIndex].paragraph : null,
    heading1: representativeHeading1 || findFirstMatch(bodyInfos, (info) => /^heading1$/i.test(info.style) && !isReferencesHeading(info)) || null,
    heading2: representativeHeading2 || findFirstMatch(bodyInfos, (info) => /^heading2$/i.test(info.style) && !isReferencesHeading(info)) || null,
    heading3: findFirstMatch(bodyInfos, (info) => /^heading3$/i.test(info.style)) || findFirstMatch(bodyInfos, (info) => /^heading3$/i.test(info.text)) || null,
    heading4: findFirstMatch(bodyInfos, (info) => /^heading4$/i.test(info.style)) || null,
    bodyFirstAfterHeading: targetBodyFirst || findFirstMatch(bodyInfos, (info) => /^p1a$/i.test(info.style)) || null,
    bodyIndented: targetBodyIndented || findFirstMatch(bodyInfos, (info) => !/^p1a$/i.test(info.style) && !isTableCaption(info) && !isFigureCaption(info) && !isLikelyHeadingLevel1(info, null) && !isLikelyHeadingLevel2(info) && !isLikelyListItem(info, null, null)) || null,
    body: targetBodyIndented || targetBodyFirst || findFirstMatch(bodyInfos, (info) => !isTableCaption(info) && !isFigureCaption(info) && !isLikelyHeadingLevel1(info, null) && !isLikelyHeadingLevel2(info) && !isLikelyListItem(info, null, null)) || null,
    bulletList: findFirstMatch(bodyInfos, (info) => /bulletitem/i.test(info.style)) || null,
    numberedList: findFirstMatch(bodyInfos, (info) => /numitem/i.test(info.style)) || null,
    tableCaption: findFirstMatch(bodyInfos, (info) => isTableCaption(info)) || null,
    figureCaption: findFirstMatch(bodyInfos, (info) => isFigureCaption(info)) || null,
    referencesHeading: referenceIndex >= 0 ? paragraphInfos[referenceIndex].paragraph : null,
    bottomHeading: representativeBottomHeading || (referenceIndex >= 0 ? paragraphInfos[referenceIndex].paragraph : null),
    referenceItem: referenceIndex >= 0 ? paragraphInfos.slice(referenceIndex + 1).find((info) => info.text)?.paragraph || null : null,
  };
};

const classifySubmittedParagraphs = (paragraphInfos) => {
  const roles = [];
  const abstractRange = getAbstractRange(paragraphInfos);
  const keywordIndex = findKeywordIndex(paragraphInfos);
  const referenceIndex = findReferenceHeadingIndex(paragraphInfos);
  const zones = buildDocumentZones(paragraphInfos);
  let firstAffiliationIndex = -1;

  for (let index = 1; index < paragraphInfos.length; index += 1) {
    if (index >= 0 && abstractRange.start >= 0 && index < abstractRange.start) {
      if (firstAffiliationIndex < 0 && (isLikelyAffiliation(paragraphInfos[index].text) || /^address$/i.test(paragraphInfos[index].style))) {
        firstAffiliationIndex = index;
      }
    }
  }

  for (let index = 0; index < paragraphInfos.length; index += 1) {
    const info = paragraphInfos[index];
    const previousInfo = paragraphInfos[index - 1] || null;
    const nextInfo = paragraphInfos[index + 1] || null;

    if (isBlankParagraph(info)) {
      roles.push({ role: 'blank', info });
      continue;
    }

    if (index === 0) {
      roles.push({ role: 'title', info });
      continue;
    }

    if (abstractRange.start >= 0 && index >= abstractRange.start && index <= abstractRange.end) {
      roles.push({ role: 'abstract', info });
      continue;
    }

    if (keywordIndex >= 0 && index === keywordIndex) {
      roles.push({ role: 'keywords', info });
      continue;
    }

    if (referenceIndex >= 0 && index === referenceIndex) {
      roles.push({ role: 'referencesHeading', info });
      continue;
    }

    if (referenceIndex >= 0 && index > referenceIndex) {
      if (isBottomSectionHeading(info)) {
        roles.push({ role: 'bottomHeading', info });
      } else {
        roles.push({ role: 'referenceItem', info });
      }
      continue;
    }

    if (abstractRange.start >= 0 && index < abstractRange.start) {
      if (EMAIL_ADDRESS_PATTERN.test(info.text)) {
        roles.push({ role: 'email', info });
        continue;
      }

      const isAffiliation = index >= firstAffiliationIndex && firstAffiliationIndex >= 0;
      roles.push({ role: isAffiliation ? 'affiliation' : 'author', info });
      continue;
    }

    if (isTableCaption(info)) {
      roles.push({ role: 'tableCaption', info });
      continue;
    }

    if (isFigureCaption(info)) {
      roles.push({ role: 'figureCaption', info });
      continue;
    }

    if (isLikelyHeadingLevel2(info)) {
      roles.push({ role: 'heading2', info });
      continue;
    }

    if (isLikelyHeadingLevel1(info, nextInfo)) {
      roles.push({ role: 'heading1', info });
      continue;
    }

    if (isLikelyListItem(info, previousInfo, nextInfo)) {
      const role = NUMBERED_LIST_PATTERN.test(info.text) || /numitem/i.test(info.style) ? 'numberedList' : 'bulletList';
      roles.push({ role, info });
      continue;
    }

    const previousRole = roles.slice().reverse().find((entry) => entry.role !== 'blank')?.role || null;
    const bodyRole = previousRole === 'heading1' || previousRole === 'heading2' || previousRole === 'heading3' || previousRole === 'heading4'
      ? BODY_FIRST_ROLE
      : BODY_CONTINUATION_ROLE;
    roles.push({ role: bodyRole, info });
  }

  return {
    roles,
    abstractRange,
    keywordIndex,
    referenceIndex,
    zones,
  };
};

const loadDocx = async (filePath) => {
  const buffer = await fs.readFile(filePath);
  const zip = await JSZip.loadAsync(buffer);
  const documentEntry = zip.file('word/document.xml');

  if (!documentEntry) {
    throw new Error(`DOCX is missing word/document.xml: ${filePath}`);
  }

  const documentXml = await documentEntry.async('string');
  const document = parser.parseFromString(documentXml, 'text/xml');
  const stylesXml = await zip.file('word/styles.xml')?.async('string');
  const stylesDocument = stylesXml ? parser.parseFromString(stylesXml, 'text/xml') : null;

  return { zip, document, stylesDocument };
};

export const rewriteDocxWithTargetStyleOverlay = async ({ targetPath, submittedPath, outputPath }) => {
  const targetDocx = await loadDocx(targetPath);
  const submittedDocx = await loadDocx(submittedPath);

  const targetParagraphInfos = getParagraphs(targetDocx.document).map(getParagraphInfo);
  const submittedParagraphInfos = getParagraphs(submittedDocx.document).map(getParagraphInfo);
  const targetExemplars = buildTargetExemplars(targetParagraphInfos);
  const classifiedSubmitted = classifySubmittedParagraphs(submittedParagraphInfos);

  if (!targetExemplars.title || !targetExemplars.body) {
    return {
      applied: false,
      mode: 'no_structure_match',
      summary: {
        formattedParagraphCount: 0,
        roleCounts: {},
        missingExemplars: Object.entries(targetExemplars)
          .filter(([, value]) => !value)
          .map(([key]) => key),
      },
    };
  }

  await copyStyleEntries(targetDocx.zip, submittedDocx.zip);

  const numberedHeadingRoles = new Set(
    ['heading1', 'heading2'].filter((role) => {
      const exemplar = targetExemplars[role];
      const styleId = exemplar ? getParagraphStyle(exemplar) : '';
      return styleHasNumbering(targetDocx.stylesDocument, styleId);
    }),
  );

  const appliedRoleCounts = {};
  const roleToExemplar = {
    title: targetExemplars.title,
    author: targetExemplars.author || targetExemplars.affiliation || targetExemplars.body,
    affiliation: targetExemplars.affiliation || targetExemplars.author || targetExemplars.body,
    email: targetExemplars.email || targetExemplars.affiliation || targetExemplars.body,
    abstract: targetExemplars.abstract || targetExemplars.body,
    keywords: targetExemplars.keywords || targetExemplars.abstract || targetExemplars.body,
    heading1: targetExemplars.heading1 || targetExemplars.heading2 || targetExemplars.body,
    heading2: targetExemplars.heading2 || targetExemplars.heading1 || targetExemplars.body,
    heading3: targetExemplars.heading3 || targetExemplars.heading2 || targetExemplars.body,
    heading4: targetExemplars.heading4 || targetExemplars.heading3 || targetExemplars.body,
    [BODY_FIRST_ROLE]: targetExemplars.bodyFirstAfterHeading || targetExemplars.bodyIndented || targetExemplars.body,
    [BODY_CONTINUATION_ROLE]: targetExemplars.bodyIndented || targetExemplars.bodyFirstAfterHeading || targetExemplars.body,
    body: targetExemplars.body,
    bulletList: targetExemplars.bulletList || targetExemplars.body,
    numberedList: targetExemplars.numberedList || targetExemplars.bulletList || targetExemplars.body,
    tableCaption: targetExemplars.tableCaption || targetExemplars.body,
    figureCaption: targetExemplars.figureCaption || targetExemplars.body,
    referencesHeading: targetExemplars.referencesHeading || targetExemplars.bottomHeading || targetExemplars.heading2 || targetExemplars.heading1 || targetExemplars.body,
    bottomHeading: targetExemplars.bottomHeading || targetExemplars.referencesHeading || targetExemplars.heading2 || targetExemplars.heading1 || targetExemplars.body,
    referenceItem: targetExemplars.referenceItem || targetExemplars.body,
  };

  for (const { role, info } of classifiedSubmitted.roles) {
    if (role === 'blank') {
      continue;
    }

    const exemplar = roleToExemplar[role] || targetExemplars.body;
    if (!exemplar) {
      continue;
    }

    applyRoleFormatting(role, info.paragraph, exemplar, {
      numberedHeadingRoles,
      emailSourceParagraph: targetExemplars.email || targetExemplars.affiliation || null,
      superscriptSourceParagraph: targetExemplars.author || null,
      headingNumberSpacingSourceParagraph: targetExemplars.heading1 || null,
      stylesDocument: targetDocx.stylesDocument,
    });
    appliedRoleCounts[role] = (appliedRoleCounts[role] || 0) + 1;
  }

  submittedDocx.zip.file('word/document.xml', serializer.serializeToString(submittedDocx.document));
  const outputBuffer = await submittedDocx.zip.generateAsync({ type: 'nodebuffer' });
  await ensureDir(path.dirname(outputPath));
  await fs.writeFile(outputPath, outputBuffer);

  return {
    applied: true,
    mode: 'document_structure_style_overlay',
    summary: {
      formattedParagraphCount: Object.values(appliedRoleCounts).reduce((sum, count) => sum + count, 0),
      roleCounts: appliedRoleCounts,
      targetExemplarStyles: Object.fromEntries(
        Object.entries(targetExemplars)
          .filter(([, paragraph]) => Boolean(paragraph))
          .map(([key, paragraph]) => [key, getParagraphStyle(paragraph)]),
      ),
    },
  };
};