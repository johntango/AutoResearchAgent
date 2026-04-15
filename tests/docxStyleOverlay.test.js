import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import { DOMParser } from '@xmldom/xmldom';
import { rewriteDocxWithTargetStyleOverlay } from '../src/utils/docxStyleOverlay.js';

const xmlEscape = (text) => text
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&apos;');

const createDocx = async ({ filePath, documentXml, stylesXml = '', numberingXml = '' }) => {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>');
  zip.file('word/document.xml', documentXml);
  if (stylesXml) {
    zip.file('word/styles.xml', stylesXml);
  }
  if (numberingXml) {
    zip.file('word/numbering.xml', numberingXml);
  }
  const buffer = await zip.generateAsync({ type: 'nodebuffer' });
  await fs.writeFile(filePath, buffer);
};

const paragraphRunsXml = ({ pStyle = '', line = '', before = '', after = '', runs = [] }) => `
  <w:p>
    <w:pPr>${pStyle ? `<w:pStyle w:val="${pStyle}"/>` : ''}${line || before || after ? `<w:spacing${before ? ` w:before="${before}"` : ''}${line ? ` w:line="${line}" w:lineRule="auto"` : ''}${after ? ` w:after="${after}"` : ''}/>` : ''}</w:pPr>
    ${runs.map((run) => `<w:r><w:rPr>${run.rStyle ? `<w:rStyle w:val="${run.rStyle}"/>` : ''}${run.font ? `<w:rFonts w:ascii="${run.font}" w:hAnsi="${run.font}"/>` : ''}${run.size ? `<w:sz w:val="${run.size}"/>` : ''}${run.bold ? '<w:b/>' : ''}${run.italic ? '<w:i/>' : ''}${run.vertAlign ? `<w:vertAlign w:val="${run.vertAlign}"/>` : ''}</w:rPr>${run.tab ? '<w:tab/>' : `<w:t>${xmlEscape(run.text || '')}</w:t>`}</w:r>`).join('')}
  </w:p>`;

const paragraphXml = ({ text, pStyle = '', size = '', italic = false, bold = false, line = '', before = '', after = '', firstLine = '', left = '', hanging = '', tabs = [] }) => `
  <w:p>
    <w:pPr>${pStyle ? `<w:pStyle w:val="${pStyle}"/>` : ''}${line || before || after ? `<w:spacing${before ? ` w:before="${before}"` : ''}${line ? ` w:line="${line}" w:lineRule="auto"` : ''}${after ? ` w:after="${after}"` : ''}/>` : ''}${firstLine || left || hanging ? `<w:ind${left ? ` w:left="${left}"` : ''}${firstLine ? ` w:firstLine="${firstLine}"` : ''}${hanging ? ` w:hanging="${hanging}"` : ''}/>` : ''}${tabs.length ? `<w:tabs>${tabs.map((tab) => `<w:tab w:val="${tab.val || 'left'}" w:pos="${tab.pos}"/>`).join('')}</w:tabs>` : ''}</w:pPr>
    <w:r>
      <w:rPr>${size ? `<w:sz w:val="${size}"/>` : ''}${bold ? '<w:b/>' : ''}${italic ? '<w:i/>' : ''}</w:rPr>
      <w:t>${xmlEscape(text)}</w:t>
    </w:r>
  </w:p>`;

const documentXml = (paragraphs) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    ${paragraphs.join('')}
  </w:body>
</w:document>`;

const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:style w:type="paragraph" w:styleId="heading1">
    <w:name w:val="heading1"/>
    <w:pPr>
      <w:numPr>
        <w:ilvl w:val="0"/>
        <w:numId w:val="5"/>
      </w:numPr>
    </w:pPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="heading2">
    <w:name w:val="heading2"/>
    <w:pPr>
      <w:numPr>
        <w:ilvl w:val="1"/>
        <w:numId w:val="5"/>
      </w:numPr>
    </w:pPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="p1a"><w:name w:val="p1a"/></w:style>
  <w:style w:type="paragraph" w:styleId="papertitle"><w:name w:val="papertitle"/></w:style>
  <w:style w:type="paragraph" w:styleId="author"><w:name w:val="author"/></w:style>
  <w:style w:type="paragraph" w:styleId="address"><w:name w:val="address"/></w:style>
  <w:style w:type="paragraph" w:styleId="abstract"><w:name w:val="abstract"/></w:style>
  <w:style w:type="paragraph" w:styleId="keywords"><w:name w:val="keywords"/></w:style>
  <w:style w:type="paragraph" w:styleId="bulletitem"><w:name w:val="bulletitem"/></w:style>
  <w:style w:type="paragraph" w:styleId="referenceitem"><w:name w:val="referenceitem"/></w:style>
  <w:style w:type="character" w:styleId="e-mail"><w:name w:val="e-mail"/></w:style>
</w:styles>`;

const targetNumberingXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:abstractNum w:abstractNumId="1">
    <w:lvl w:ilvl="0">
      <w:start w:val="1"/>
      <w:numFmt w:val="decimal"/>
      <w:lvlText w:val="%1"/>
      <w:suff w:val="tab"/>
      <w:pPr>
        <w:tabs>
          <w:tab w:val="num" w:pos="480"/>
        </w:tabs>
        <w:ind w:left="480" w:hanging="480"/>
      </w:pPr>
    </w:lvl>
    <w:lvl w:ilvl="1">
      <w:start w:val="1"/>
      <w:numFmt w:val="decimal"/>
      <w:lvlText w:val="%1.%2"/>
      <w:suff w:val="tab"/>
      <w:pPr>
        <w:tabs>
          <w:tab w:val="num" w:pos="480"/>
        </w:tabs>
        <w:ind w:left="480" w:hanging="480"/>
      </w:pPr>
    </w:lvl>
  </w:abstractNum>
  <w:num w:numId="5">
    <w:abstractNumId w:val="1"/>
  </w:num>
</w:numbering>`;

const submittedNumberingXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:abstractNum w:abstractNumId="1">
    <w:lvl w:ilvl="0">
      <w:start w:val="1"/>
      <w:numFmt w:val="decimal"/>
      <w:lvlText w:val="%1"/>
      <w:suff w:val="tab"/>
      <w:pPr>
        <w:tabs>
          <w:tab w:val="num" w:pos="720"/>
        </w:tabs>
        <w:ind w:left="720" w:hanging="360"/>
      </w:pPr>
    </w:lvl>
    <w:lvl w:ilvl="1">
      <w:start w:val="1"/>
      <w:numFmt w:val="decimal"/>
      <w:lvlText w:val="%1.%2"/>
      <w:suff w:val="tab"/>
      <w:pPr>
        <w:tabs>
          <w:tab w:val="num" w:pos="1440"/>
        </w:tabs>
        <w:ind w:left="1440" w:hanging="360"/>
      </w:pPr>
    </w:lvl>
  </w:abstractNum>
  <w:num w:numId="5">
    <w:abstractNumId w:val="1"/>
  </w:num>
</w:numbering>`;

const getParagraphs = async (filePath) => {
  const buffer = await fs.readFile(filePath);
  const zip = await JSZip.loadAsync(buffer);
  const xml = await zip.file('word/document.xml').async('string');
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  return Array.from(doc.getElementsByTagName('w:p')).map((paragraph) => ({
    text: Array.from(paragraph.getElementsByTagName('w:t')).map((node) => node.textContent).join(''),
    style: paragraph.getElementsByTagName('w:pStyle')[0]?.getAttribute('w:val') || '',
    size: paragraph.getElementsByTagName('w:sz')[0]?.getAttribute('w:val') || '',
    bold: paragraph.getElementsByTagName('w:b').length > 0,
    italic: paragraph.getElementsByTagName('w:i').length > 0,
    line: paragraph.getElementsByTagName('w:spacing')[0]?.getAttribute('w:line') || '',
    before: paragraph.getElementsByTagName('w:spacing')[0]?.getAttribute('w:before') || '',
    left: paragraph.getElementsByTagName('w:ind')[0]?.getAttribute('w:left') || '',
    hanging: paragraph.getElementsByTagName('w:ind')[0]?.getAttribute('w:hanging') || '',
    firstLine: paragraph.getElementsByTagName('w:ind')[0]?.getAttribute('w:firstLine') || '',
    tab: paragraph.getElementsByTagName('w:tab')[0]?.getAttribute('w:pos') || '',
  }));
};

test('rewriteDocxWithTargetStyleOverlay applies target structure formatting across the document', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'docx-style-overlay-'));
  const targetPath = path.join(root, 'target.docx');
  const submittedPath = path.join(root, 'submitted.docx');
  const outputPath = path.join(root, 'output.docx');

  await createDocx({
    filePath: targetPath,
    stylesXml,
    numberingXml: targetNumberingXml,
    documentXml: documentXml([
      paragraphXml({ text: 'Target Title', pStyle: 'papertitle', size: '28', bold: true, line: '480' }),
      paragraphRunsXml({ pStyle: 'author', runs: [
        { text: 'Author One', size: '18' },
        { text: '1', size: '18', vertAlign: 'superscript' },
        { text: ', Author Two', size: '18' },
        { text: '2', size: '18', vertAlign: 'superscript' },
      ] }),
      paragraphXml({ text: '1 Example University', pStyle: 'address', size: '16' }),
      paragraphRunsXml({ pStyle: 'abstract', line: '360', runs: [
        { text: 'Abstract.', size: '18', bold: true },
        { text: ' ', size: '18' },
        { text: 'Target abstract text.', size: '18', bold: false },
      ] }),
      paragraphXml({ text: 'Keywords: alpha, beta', pStyle: 'keywords', size: '18', line: '360' }),
      paragraphXml({ text: 'Introduction', pStyle: 'heading1', size: '24', bold: true, line: '320', before: '240', left: '480', hanging: '480', tabs: [{ pos: '480' }] }),
      paragraphXml({ text: 'Target first body text.', pStyle: 'p1a', size: '18', line: '320' }),
      paragraphXml({ text: 'Target indented body text.', pStyle: 'NormalWeb', size: '18', line: '320', firstLine: '360' }),
      paragraphXml({ text: '1.0 Transitional Subheading', pStyle: 'heading2', size: '20', bold: true, line: '300', before: '0', left: '720', hanging: '360', tabs: [{ pos: '720' }] }),
      paragraphXml({ text: 'Target transition text.', pStyle: 'p1a', size: '18', line: '320' }),
      paragraphXml({ text: '1.1 Subheading', pStyle: 'heading2', size: '20', bold: true, line: '300', before: '240', left: '720', hanging: '360', tabs: [{ pos: '720' }] }),
      paragraphXml({ text: 'Target first sub body text.', pStyle: 'p1a', size: '18', line: '320' }),
      paragraphXml({ text: 'Bullet exemplar', pStyle: 'bulletitem', size: '18', line: '300' }),
      paragraphXml({ text: 'References', pStyle: 'heading2', size: '20', bold: true, line: '300', before: '240', left: '720', hanging: '360' }),
      paragraphXml({ text: 'Target reference item.', pStyle: 'referenceitem', size: '18', line: '280' }),
    ]),
  });

  await createDocx({
    filePath: submittedPath,
    stylesXml,
    numberingXml: submittedNumberingXml,
    documentXml: documentXml([
      paragraphXml({ text: 'Submitted Title', pStyle: 'papertitle', size: '34', italic: true, line: '240' }),
      paragraphRunsXml({ pStyle: 'author', runs: [
        { text: 'Author A', size: '22', italic: true },
        { text: '1', size: '22', italic: true },
        { text: ', Author B', size: '22', italic: true },
        { text: '2', size: '22', italic: true },
      ] }),
      paragraphXml({ text: '1 Example Lab', pStyle: 'address', size: '22', italic: true }),
      paragraphRunsXml({ pStyle: 'NormalWeb', line: '240', runs: [
        { text: 'Abstract. ', size: '30', bold: true },
        { text: 'Submitted abstract text.', size: '30', italic: true },
      ] }),
      paragraphXml({ text: 'Keywords: delta, gamma', pStyle: 'keywords', size: '26', italic: true, line: '240' }),
      paragraphXml({ text: 'Introduction', pStyle: 'heading1', size: '18', italic: true, line: '240', firstLine: '360' }),
      paragraphXml({ text: 'Submitted first body text.', pStyle: 'NormalWeb', size: '26', italic: true, line: '240', firstLine: '360' }),
      paragraphXml({ text: 'Submitted second body text.', pStyle: 'NormalWeb', size: '26', italic: true, line: '240' }),
      paragraphRunsXml({ pStyle: 'NormalWeb', line: '240', runs: [
        { text: '1.1', size: '26', italic: true },
        { tab: true, size: '26', italic: true },
        { text: 'Subheading', size: '26', italic: true },
      ] }),
      paragraphXml({ text: 'Submitted first sub body text.', pStyle: 'NormalWeb', size: '26', italic: true, line: '240', firstLine: '360' }),
      paragraphXml({ text: 'List item one', pStyle: 'NormalWeb', size: '26', italic: true, line: '240' }),
      paragraphXml({ text: 'List item two', pStyle: 'NormalWeb', size: '26', italic: true, line: '240' }),
      paragraphXml({ text: 'References', pStyle: 'heading2', size: '26', italic: true, line: '240', firstLine: '360' }),
      paragraphXml({ text: 'Submitted reference item.', pStyle: 'referenceitem', size: '26', italic: true, line: '240' }),
    ]),
  });

  const result = await rewriteDocxWithTargetStyleOverlay({ targetPath, submittedPath, outputPath });
  assert.equal(result.applied, true);
  assert.equal(result.mode, 'document_structure_style_overlay');

  const paragraphs = await getParagraphs(outputPath);
  const title = paragraphs.find((paragraph) => paragraph.text === 'Submitted Title');
  const author = paragraphs.find((paragraph) => paragraph.text === 'Author A1, Author B2');
  const abstract = paragraphs.find((paragraph) => paragraph.text === 'Abstract. Submitted abstract text.');
  const keywords = paragraphs.find((paragraph) => paragraph.text === 'Keywords: delta, gamma');
  const heading1 = paragraphs.find((paragraph) => paragraph.text === 'Introduction');
  const firstBody = paragraphs.find((paragraph) => paragraph.text === 'Submitted first body text.');
  const secondBody = paragraphs.find((paragraph) => paragraph.text === 'Submitted second body text.');
  const heading2 = paragraphs.find((paragraph) => paragraph.text === 'Subheading');
  const firstSubBody = paragraphs.find((paragraph) => paragraph.text === 'Submitted first sub body text.');
  const listItem = paragraphs.find((paragraph) => paragraph.text === 'List item one');
  const secondListItem = paragraphs.find((paragraph) => paragraph.text === 'List item two');
  const referencesHeading = paragraphs.find((paragraph) => paragraph.text === 'References');
  const referenceItem = paragraphs.find((paragraph) => paragraph.text === 'Submitted reference item.');

  assert.equal(title.size, '28');
  assert.equal(title.italic, false);
  assert.equal(title.line, '480');
  assert.equal(author.italic, false);
  assert.equal(abstract.size, '18');
  assert.equal(abstract.bold, true);
  assert.equal(abstract.italic, false);
  assert.equal(abstract.line, '360');
  assert.equal(keywords.size, '18');
  assert.equal(heading1.size, '24');
  assert.equal(heading1.bold, true);
  assert.equal(heading1.style, 'heading1');
  assert.equal(heading1.firstLine, '');
  assert.equal(heading1.left, '480');
  assert.equal(heading1.hanging, '480');
  assert.equal(heading1.tab, '480');
  assert.equal(heading1.before, '240');
  assert.equal(firstBody.size, '18');
  assert.equal(firstBody.line, '320');
  assert.equal(firstBody.firstLine, '');
  assert.equal(secondBody.size, '18');
  assert.equal(secondBody.firstLine, '360');
  assert.equal(heading2.size, '20');
  assert.equal(heading2.bold, true);
  assert.equal(heading2.text.startsWith('1.1'), false);
  assert.equal(heading2.style, 'heading2');
  assert.equal(heading2.firstLine, '0');
  assert.equal(heading2.left, '0');
  assert.equal(heading2.hanging, '0');
  assert.equal(heading2.tab, '480');
  assert.equal(heading2.before, '240');
  assert.equal(firstSubBody.firstLine, '');
  assert.equal(listItem.style, 'bulletitem');
  assert.equal(listItem.size, '18');
  assert.equal(secondListItem.style, 'bulletitem');
  assert.equal(secondListItem.size, '18');
  assert.equal(referencesHeading.size, '20');
  assert.equal(referencesHeading.bold, true);
  assert.equal(referencesHeading.style, '');
  assert.equal(referencesHeading.firstLine, '0');
  assert.equal(referencesHeading.before, '240');
  assert.equal(referenceItem.size, '18');
  assert.equal(referenceItem.line, '280');

  const buffer = await fs.readFile(outputPath);
  const zip = await JSZip.loadAsync(buffer);
  const outputNumberingXml = await zip.file('word/numbering.xml').async('string');
  const xml = await zip.file('word/document.xml').async('string');
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  const authorParagraph = Array.from(doc.getElementsByTagName('w:p')).find((paragraph) => Array.from(paragraph.getElementsByTagName('w:t')).map((node) => node.textContent).join('') === 'Author A1, Author B2');
  const abstractParagraph = Array.from(doc.getElementsByTagName('w:p')).find((paragraph) => Array.from(paragraph.getElementsByTagName('w:t')).map((node) => node.textContent).join('') === 'Abstract. Submitted abstract text.');
  const authorRunTexts = Array.from(authorParagraph.getElementsByTagName('w:r')).map((run) => ({
    text: Array.from(run.getElementsByTagName('w:t')).map((node) => node.textContent).join(''),
    vertAlign: run.getElementsByTagName('w:vertAlign')[0]?.getAttribute('w:val') || '',
  }));
  const abstractRuns = Array.from(abstractParagraph.getElementsByTagName('w:r')).map((run) => ({
    text: Array.from(run.getElementsByTagName('w:t')).map((node) => node.textContent).join(''),
    bold: run.getElementsByTagName('w:b').length > 0,
  }));

  assert.equal(authorRunTexts.find((run) => run.text === '1').vertAlign, 'superscript');
  assert.equal(authorRunTexts.find((run) => run.text === '2').vertAlign, 'superscript');
  assert.equal(abstractRuns.find((run) => run.text === 'Submitted abstract text.').bold, false);
  assert.match(outputNumberingXml, /w:tab w:val="num" w:pos="480"/);
  assert.doesNotMatch(outputNumberingXml, /w:tab w:val="num" w:pos="1440"/);
});

test('rewriteDocxWithTargetStyleOverlay preserves client-id superscripts and target email font in front matter', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'docx-style-overlay-frontmatter-'));
  const targetPath = path.join(root, 'target.docx');
  const submittedPath = path.join(root, 'submitted.docx');
  const outputPath = path.join(root, 'output.docx');

  await createDocx({
    filePath: targetPath,
    stylesXml,
    documentXml: documentXml([
      paragraphXml({ text: 'Target Title', pStyle: 'papertitle', size: '28', bold: true, line: '480' }),
      paragraphRunsXml({ pStyle: 'author', runs: [
        { text: 'Author One', size: '18' },
        { text: '1', size: '18', vertAlign: 'superscript' },
        { text: ' <CID-1234>', size: '18', vertAlign: 'superscript' },
      ] }),
      paragraphXml({ text: '1 Example University', pStyle: 'address', size: '16' }),
      paragraphRunsXml({ pStyle: 'address', runs: [
        { text: 'Contact: ', size: '16', font: 'Times New Roman' },
        { text: 'author@example.edu', size: '16', font: 'Courier New', rStyle: 'e-mail' },
      ] }),
      paragraphRunsXml({ pStyle: 'abstract', line: '360', runs: [
        { text: 'Abstract.', size: '18', bold: true },
        { text: ' Target abstract text.', size: '18' },
      ] }),
      paragraphXml({ text: 'Introduction', pStyle: 'heading1', size: '24', bold: true, line: '320', before: '240' }),
      paragraphXml({ text: 'Target first body text.', pStyle: 'p1a', size: '18', line: '320' }),
    ]),
  });

  await createDocx({
    filePath: submittedPath,
    stylesXml,
    documentXml: documentXml([
      paragraphXml({ text: 'Submitted Title', pStyle: 'papertitle', size: '34', italic: true, line: '240' }),
      paragraphRunsXml({ pStyle: 'author', runs: [
        { text: 'Author A', size: '22', italic: true },
        { text: '1', size: '22', italic: true },
        { text: ' <CID-9999>', size: '22', italic: true },
      ] }),
      paragraphXml({ text: '1 Example Lab', pStyle: 'address', size: '22', italic: true }),
      paragraphRunsXml({ pStyle: 'address', runs: [
        { text: 'person@lab.example', size: '22', font: 'Arial' },
      ] }),
      paragraphRunsXml({ pStyle: 'NormalWeb', line: '240', runs: [
        { text: 'Abstract.', size: '30', bold: true },
        { text: ' Submitted abstract text.', size: '30', italic: true },
      ] }),
      paragraphXml({ text: 'Introduction', pStyle: 'heading1', size: '18', italic: true, line: '240', firstLine: '360' }),
      paragraphXml({ text: 'Submitted first body text.', pStyle: 'NormalWeb', size: '26', italic: true, line: '240', firstLine: '360' }),
    ]),
  });

  const result = await rewriteDocxWithTargetStyleOverlay({ targetPath, submittedPath, outputPath });
  assert.equal(result.applied, true);

  const buffer = await fs.readFile(outputPath);
  const zip = await JSZip.loadAsync(buffer);
  const xml = await zip.file('word/document.xml').async('string');
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  const paragraphs = Array.from(doc.getElementsByTagName('w:p'));
  const authorParagraph = paragraphs.find((paragraph) => Array.from(paragraph.getElementsByTagName('w:t')).map((node) => node.textContent).join('') === 'Author A1 <CID-9999>');
  const emailParagraph = paragraphs.find((paragraph) => Array.from(paragraph.getElementsByTagName('w:t')).map((node) => node.textContent).join('') === 'person@lab.example');

  const authorRuns = Array.from(authorParagraph.getElementsByTagName('w:r')).map((run) => ({
    text: Array.from(run.getElementsByTagName('w:t')).map((node) => node.textContent).join(''),
    vertAlign: run.getElementsByTagName('w:vertAlign')[0]?.getAttribute('w:val') || '',
  }));
  const emailRun = Array.from(emailParagraph.getElementsByTagName('w:r')).find((run) => Array.from(run.getElementsByTagName('w:t')).map((node) => node.textContent).join('').includes('@'));

  assert.equal(authorRuns.find((run) => run.text === '1').vertAlign, 'superscript');
  assert.equal(authorRuns.find((run) => run.text === ' <CID-9999>').vertAlign, 'superscript');
  assert.equal(emailRun.getElementsByTagName('w:rStyle')[0]?.getAttribute('w:val') || '', 'e-mail');
  assert.equal(emailRun.getElementsByTagName('w:rFonts')[0]?.getAttribute('w:ascii') || '', 'Courier New');
});

test('rewriteDocxWithTargetStyleOverlay stops superscript at each author cluster boundary', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'docx-style-overlay-author-clusters-'));
  const targetPath = path.join(root, 'target.docx');
  const submittedPath = path.join(root, 'submitted.docx');
  const outputPath = path.join(root, 'output.docx');

  await createDocx({
    filePath: targetPath,
    stylesXml,
    documentXml: documentXml([
      paragraphXml({ text: 'Target Title', pStyle: 'papertitle', size: '28', bold: true, line: '480' }),
      paragraphRunsXml({ pStyle: 'author', runs: [
        { text: 'Alice Smith', size: '18' },
        { text: '1', size: '18', vertAlign: 'superscript' },
        { text: ' <CID-1000>', size: '18', vertAlign: 'superscript' },
        { text: ', Bob Jones, Cara Mills', size: '18' },
        { text: '2', size: '18', vertAlign: 'superscript' },
      ] }),
      paragraphRunsXml({ pStyle: 'address', runs: [
        { text: 'Research Group ', size: '16', font: 'Times New Roman' },
        { text: 'alice@example.edu', size: '16', font: 'Courier New', rStyle: 'e-mail' },
      ] }),
      paragraphRunsXml({ pStyle: 'abstract', line: '360', runs: [
        { text: 'Abstract.', size: '18', bold: true },
        { text: ' Target abstract text.', size: '18' },
      ] }),
      paragraphXml({ text: 'Introduction', pStyle: 'heading1', size: '24', bold: true, line: '320', before: '240' }),
      paragraphXml({ text: 'Target first body text.', pStyle: 'p1a', size: '18', line: '320' }),
    ]),
  });

  await createDocx({
    filePath: submittedPath,
    stylesXml,
    documentXml: documentXml([
      paragraphXml({ text: 'Submitted Title', pStyle: 'papertitle', size: '34', italic: true, line: '240' }),
      paragraphRunsXml({ pStyle: 'author', runs: [
        { text: 'Alice Smith1 <CID-9999>, Bob Jones, Cara Mills2', size: '22', italic: true },
      ] }),
      paragraphRunsXml({ pStyle: 'address', runs: [
        { text: 'Research Group alice@example.edu', size: '22', font: 'Arial' },
      ] }),
      paragraphRunsXml({ pStyle: 'NormalWeb', line: '240', runs: [
        { text: 'Abstract.', size: '30', bold: true },
        { text: ' Submitted abstract text.', size: '30', italic: true },
      ] }),
      paragraphXml({ text: 'Introduction', pStyle: 'heading1', size: '18', italic: true, line: '240', firstLine: '360' }),
      paragraphXml({ text: 'Submitted first body text.', pStyle: 'NormalWeb', size: '26', italic: true, line: '240', firstLine: '360' }),
    ]),
  });

  const result = await rewriteDocxWithTargetStyleOverlay({ targetPath, submittedPath, outputPath });
  assert.equal(result.applied, true);

  const buffer = await fs.readFile(outputPath);
  const zip = await JSZip.loadAsync(buffer);
  const xml = await zip.file('word/document.xml').async('string');
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  const paragraphs = Array.from(doc.getElementsByTagName('w:p'));
  const authorParagraph = paragraphs.find((paragraph) => Array.from(paragraph.getElementsByTagName('w:t')).map((node) => node.textContent).join('') === 'Alice Smith1 <CID-9999>, Bob Jones, Cara Mills2');
  const emailParagraph = paragraphs.find((paragraph) => Array.from(paragraph.getElementsByTagName('w:t')).map((node) => node.textContent).join('') === 'Research Group alice@example.edu');

  const authorRuns = Array.from(authorParagraph.getElementsByTagName('w:r')).map((run) => ({
    text: Array.from(run.getElementsByTagName('w:t')).map((node) => node.textContent).join(''),
    vertAlign: run.getElementsByTagName('w:vertAlign')[0]?.getAttribute('w:val') || '',
  }));
  const emailRuns = Array.from(emailParagraph.getElementsByTagName('w:r')).map((run) => ({
    text: Array.from(run.getElementsByTagName('w:t')).map((node) => node.textContent).join(''),
    font: run.getElementsByTagName('w:rFonts')[0]?.getAttribute('w:ascii') || '',
    rStyle: run.getElementsByTagName('w:rStyle')[0]?.getAttribute('w:val') || '',
    vertAlign: run.getElementsByTagName('w:vertAlign')[0]?.getAttribute('w:val') || '',
  }));

  assert.equal(authorRuns.find((run) => run.text.includes('1 <CID-9999>')).vertAlign, 'superscript');
  assert.equal(authorRuns.find((run) => run.text === ', Bob Jones, Cara Mills').vertAlign, '');
  assert.equal(authorRuns.find((run) => run.text === '2').vertAlign, 'superscript');
  assert.equal(emailRuns.find((run) => run.text.includes('alice@example.edu')).font, 'Courier New');
  assert.equal(emailRuns.find((run) => run.text.includes('alice@example.edu')).rStyle, 'e-mail');
  assert.equal(emailRuns.find((run) => run.text === 'Research Group ').vertAlign, '');
});