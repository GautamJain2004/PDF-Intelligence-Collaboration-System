/**
 * Generates a realistic multi-page sample PDF for manual and pipeline testing.
 *
 *   npx tsx scripts/make-sample-pdf.ts
 *
 * The content is deliberately contract-shaped: specific parties, figures, dates,
 * and clause numbers. That makes it possible to check the things that actually
 * matter — whether the summary names real specifics instead of hedging, whether
 * retrieval finds a clause by meaning ("who pays for travel?") as well as by
 * exact term ("Clause 7.2"), and whether page citations point at the right page.
 */
import PDFDocument from 'pdfkit';
import { createWriteStream, mkdirSync } from 'node:fs';
import path from 'node:path';

type Section = { heading: string; body: string[] };

const SECTIONS: Section[] = [
  {
    heading: '1. Parties and Commencement',
    body: [
      'This Employment Agreement ("Agreement") is made on 14 March 2024 between Northwind Analytics Ltd, a company registered in England and Wales under company number 09928471, with its registered office at 42 Cheapside, London EC2V 6AH ("the Company"), and Priya Raghunathan of 18 Alder Grove, Bristol BS6 5TT ("the Employee").',
      'The Employee shall commence employment on 6 May 2024. The first six months of employment constitute a probationary period, during which either party may terminate this Agreement on two weeks written notice.',
      'The Employee is engaged in the role of Senior Data Engineer, reporting to the Head of Platform Engineering.',
    ],
  },
  {
    heading: '2. Remuneration',
    body: [
      'The Company shall pay the Employee a gross annual salary of GBP 78,500, payable monthly in arrears on the last working day of each calendar month by bank transfer.',
      'The salary shall be reviewed annually each April. Review does not guarantee an increase.',
      'The Employee is eligible for a discretionary annual bonus of up to 15% of base salary, determined by individual and company performance. Bonus payments are made in March and require the Employee to remain in employment and not under notice on the payment date.',
    ],
  },
  {
    heading: '3. Working Hours and Location',
    body: [
      'Normal working hours are 37.5 hours per week, Monday to Friday. The Employee is not required to work a fixed daily schedule provided contracted hours are met and core hours of 10:00 to 15:00 are observed.',
      'The Employee’s principal place of work is the Company’s Bristol office. The Employee may work remotely up to three days per week by agreement with their line manager.',
    ],
  },
  {
    heading: '4. Holiday Entitlement',
    body: [
      'The Employee is entitled to 27 days of paid annual leave per holiday year, in addition to public holidays in England and Wales.',
      'The holiday year runs from 1 January to 31 December. A maximum of five unused days may be carried into the following holiday year and must be taken before 31 March.',
      'On termination, accrued but untaken holiday is paid in lieu at 1/260th of annual salary per day.',
    ],
  },
  {
    heading: '5. Confidentiality',
    body: [
      'The Employee shall not, during employment or at any time after its termination, disclose to any third party any confidential information belonging to the Company, its clients, or its suppliers.',
      'Confidential information includes but is not limited to source code, model weights, customer lists, pricing structures, unpublished financial results, and the terms of this Agreement.',
      'This obligation does not apply to information that enters the public domain other than through the Employee’s breach, or to protected disclosures made under the Public Interest Disclosure Act 1998.',
    ],
  },
  {
    heading: '6. Intellectual Property',
    body: [
      'All intellectual property created by the Employee in the course of employment shall vest in the Company absolutely upon creation.',
      'The Employee waives all moral rights in such works to the fullest extent permitted by law, and agrees to execute any documents reasonably required to give effect to this clause.',
      'Pre-existing intellectual property listed in Schedule A remains the property of the Employee and is licensed to the Company on a non-exclusive, royalty-free basis.',
    ],
  },
  {
    heading: '7. Expenses',
    body: [
      'The Company shall reimburse the Employee for reasonable expenses properly incurred in the performance of their duties, subject to submission of receipts within 60 days.',
      'Clause 7.2: Travel undertaken at the Company’s request beyond the Employee’s normal commute shall be reimbursed at HMRC-approved mileage rates, currently 45 pence per mile for the first 10,000 miles in a tax year and 25 pence per mile thereafter.',
      'Overnight accommodation requires prior written approval where the nightly rate exceeds GBP 180 in London or GBP 130 elsewhere in the United Kingdom.',
    ],
  },
  {
    heading: '8. Termination',
    body: [
      'After the probationary period, either party may terminate this Agreement by giving three months written notice.',
      'The Company may terminate without notice in cases of gross misconduct, including but not limited to dishonesty, unauthorised disclosure of confidential information, or serious breach of the Company’s information security policy.',
      'The Company reserves the right to make a payment in lieu of notice equal to basic salary for the unexpired notice period, excluding bonus and benefits.',
    ],
  },
  {
    heading: '9. Post-Termination Restrictions',
    body: [
      'For six months following termination, the Employee shall not solicit business from any client of the Company with whom the Employee had material dealings in the twelve months preceding termination.',
      'For six months following termination, the Employee shall not solicit or employ any person who was a senior employee of the Company at the date of termination.',
      'The parties agree these restrictions are reasonable and necessary to protect the Company’s legitimate business interests.',
    ],
  },
  {
    heading: '10. Governing Law',
    body: [
      'This Agreement is governed by the laws of England and Wales, and the parties submit to the exclusive jurisdiction of the courts of England and Wales.',
      'This Agreement constitutes the entire agreement between the parties and supersedes all prior negotiations, representations, and agreements, whether written or oral.',
    ],
  },
];

function main() {
  const outDir = path.join(process.cwd(), 'sample-data');
  mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, 'Agreement_v3.pdf');

  const doc = new PDFDocument({ size: 'A4', margin: 64, bufferPages: true });
  doc.pipe(createWriteStream(outPath));

  doc.font('Helvetica-Bold').fontSize(18).text('EMPLOYMENT AGREEMENT', { align: 'center' });
  doc.moveDown(0.4);
  doc
    .font('Helvetica')
    .fontSize(10)
    .fillColor('#444')
    .text('Northwind Analytics Ltd  ·  Private and Confidential  ·  Version 3', {
      align: 'center',
    });
  doc.fillColor('#000').moveDown(1.6);

  for (const section of SECTIONS) {
    // Keep each section on one page where it fits, so page citations are
    // meaningful when checking retrieval.
    if (doc.y > 620) doc.addPage();

    doc.font('Helvetica-Bold').fontSize(12).text(section.heading);
    doc.moveDown(0.35);
    doc.font('Helvetica').fontSize(10.5);

    for (const paragraph of section.body) {
      doc.text(paragraph, { align: 'justify', lineGap: 1.5 });
      doc.moveDown(0.5);
    }
    doc.moveDown(0.6);
  }

  doc.addPage();
  doc.font('Helvetica-Bold').fontSize(12).text('Schedule A — Retained Intellectual Property');
  doc.moveDown(0.4);
  doc
    .font('Helvetica')
    .fontSize(10.5)
    .text(
      'The Employee retains ownership of the open-source library "tessellate-rs", published under the MIT licence prior to the commencement date, and of any contributions made to it outside working hours using no Company resources.',
      { align: 'justify' },
    );
  doc.moveDown(1.2);
  doc.text('Signed for and on behalf of Northwind Analytics Ltd:');
  doc.moveDown(1.6);
  doc.text('_______________________________     Date: __________');
  doc.moveDown(1.2);
  doc.text('Signed by the Employee:');
  doc.moveDown(1.6);
  doc.text('_______________________________     Date: __________');

  // Page numbers, added after layout so the total is known.
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i);
    doc
      .font('Helvetica')
      .fontSize(8)
      .fillColor('#777')
      .text(`Page ${i + 1} of ${range.count}`, 64, 780, { align: 'center', width: 468 });
  }

  doc.end();
  console.log(`Wrote ${outPath} (${range.count} pages)`);
}

main();
