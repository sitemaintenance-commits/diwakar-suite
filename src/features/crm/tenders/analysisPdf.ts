// The tender analysis as a downloadable PDF report. pdfmake (about 2 MB with
// its fonts) is loaded only when someone clicks Download, so it never slows
// the app down. Its bundled Roboto font has the ₹ sign.
import type { Content, TableCell, TDocumentDefinitions } from 'pdfmake/interfaces';
import type { TenderAiSummary } from '@/lib/types';
import type { AiFields } from '@/features/crm/tenders/ai';
import { TENDER_TYPE_LABEL } from '@/features/crm/shared';

const BRAND = '#e8740c';
const INK = '#0f172a';
const MUTED = '#64748b';
const LINE = '#e2e8f0';

const inr = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 0 })}` : null;
};
const when = (v: unknown, withTime: boolean) => {
  if (typeof v !== 'string' || !v) return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return v;
  return new Intl.DateTimeFormat('en-IN', {
    day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata',
    ...(withTime ? { hour: 'numeric', minute: '2-digit' } : {}),
  }).format(d);
};

/** Label/value rows for the tender, skipping anything unknown. */
function detailRows(f: AiFields): [string, string][] {
  const rows: [string, string | null][] = [
    ['Tender / NIT no.', (f.reference_no as string) ?? null],
    ['Authority', (f.authority as string) ?? null],
    ['Portal', (f.portal as string) ?? null],
    ['Tender type', f.tender_type ? TENDER_TYPE_LABEL[String(f.tender_type)] ?? String(f.tender_type) : null],
    ['Scope', (f.work_type as string) ?? null],
    ['Location', [f.location, f.district, f.state].filter(Boolean).join(', ') || null],
    ['Capacity', f.capacity_kwp ? `${Number(f.capacity_kwp).toLocaleString('en-IN')} kWp` : null],
    ['Estimated value', inr(f.estimated_value)],
    ['EMD', [inr(f.emd_amount), f.emd_mode].filter(Boolean).join(' · ') || null],
    ['Tender fee', inr(f.tender_fee)],
    ['Published', when(f.published_on, false)],
    ['Pre-bid meeting', when(f.prebid_at, true)],
    ['Bid submission due', when(f.submission_due_at, true)],
    ['Technical opening', when(f.technical_opening_at, true)],
    ['Completion period', f.completion_days ? `${f.completion_days} days` : null],
  ];
  return rows.filter((r): r is [string, string] => Boolean(r[1]));
}

// headlineLevel marks headings so pageBreakBefore can keep them with their text.
const h1 = (text: string): Content => ({ text, style: 'h1', margin: [0, 16, 0, 6], headlineLevel: 1 });
const h2 = (text: string): Content => ({ text, style: 'h2', margin: [0, 8, 0, 4], headlineLevel: 2 });

function bullets(title: string, items: string[] | undefined): Content[] {
  if (!items?.length) return [];
  return [h2(title), { ul: items, margin: [0, 0, 0, 4] }];
}

function pairs(title: string, items: { label: string; value: string }[] | undefined): Content[] {
  if (!items?.length) return [];
  return [h2(title), keyValueTable(items.map((x) => [x.label, x.value]))];
}

function keyValueTable(rows: [string, string][]): Content {
  return {
    table: { widths: [140, '*'], body: rows.map(([k, v]) => [{ text: k, color: MUTED }, { text: v, bold: true }]) },
    layout: { hLineColor: () => LINE, vLineWidth: () => 0, hLineWidth: (i: number) => (i === 0 ? 0 : 0.5), paddingTop: () => 3, paddingBottom: () => 3 },
    margin: [0, 0, 0, 6],
  };
}

/** A table with a shaded header row; long text wraps inside its column. */
function grid(headers: string[], widths: (string | number)[], rows: string[][]): Content {
  const head: TableCell[] = headers.map((h) => ({ text: h, bold: true, fillColor: '#f1f5f9', fontSize: 8.5 }));
  return {
    table: { headerRows: 1, widths, dontBreakRows: false, body: [head, ...rows.map((r) => r.map((c) => ({ text: c || '—', fontSize: 8.5 })))] },
    layout: { hLineColor: () => LINE, vLineColor: () => LINE, hLineWidth: () => 0.5, vLineWidth: () => 0.5, paddingTop: () => 4, paddingBottom: () => 4 },
    margin: [0, 2, 0, 8],
  };
}

const severityColor = (s: string) => (/high|critical/i.test(s) ? '#b91c1c' : /medium/i.test(s) ? '#b45309' : /low/i.test(s) ? '#15803d' : MUTED);
const decisionColor = (d: string) => (/no-?go/i.test(d) ? '#b91c1c' : /^go\b/i.test(d) ? '#15803d' : '#b45309');

export function buildAnalysisPdf(summary: TenderAiSummary, fields: AiFields | null | undefined, title: string): TDocumentDefinitions {
  const f = fields ?? {};
  const generated = when(new Date().toISOString(), true);
  const content: Content[] = [
    { text: 'TENDER ANALYSIS REPORT', color: BRAND, bold: true, fontSize: 9, characterSpacing: 1.5 },
    { text: title || String(f.title ?? 'Tender'), style: 'title', margin: [0, 4, 0, 2] },
    { text: `Diwakar Solar · generated ${generated}`, color: MUTED, fontSize: 9, margin: [0, 0, 0, 8] },
  ];

  const details = detailRows(f);
  if (details.length) content.push(h1('Tender details'), keyValueTable(details));

  const b = summary.brief;
  if (b) {
    content.push(
      h1('Summary'),
      { text: b.headline, bold: true, margin: [0, 0, 0, 6] },
      ...(b.at_a_glance.length ? [keyValueTable(b.at_a_glance.map((x) => [x.label, x.value] as [string, string]))] : []),
      ...bullets('Key points', b.key_points),
      ...bullets('Top risks', b.top_risks),
      h2('Decision'),
      { text: b.decision, margin: [0, 0, 0, 4] },
      ...bullets('Next steps', b.next_steps),
    );
  }

  if (summary.overview) content.push(h1('Overview'), { text: summary.overview, margin: [0, 0, 0, 4] });
  if (summary.processing?.length) content.push(h1('1. Document reading / OCR coverage'), { ul: summary.processing });

  content.push(
    h1(summary.processing ? '2. Tender synopsis' : 'Tender synopsis'),
    ...pairs('Key dates', summary.key_dates),
    ...pairs('Money', summary.financials),
    ...bullets('Scope of work', summary.scope),
    ...bullets('Eligibility', summary.eligibility),
    ...bullets('Documents to submit', summary.documents_required),
    ...bullets('BOQ highlights', summary.boq_highlights),
    ...bullets('Submission requirements', summary.submission_requirements),
  );

  if (summary.risk_analysis?.length) {
    content.push(
      h1('3. Risk analysis'),
      grid(['Area', 'Severity', 'Finding', 'Evidence', 'Action'], [70, 45, '*', '*', '*'],
        summary.risk_analysis.map((r) => [r.category, r.severity, r.finding, r.evidence, r.action])),
    );
    // Colour the severity column.
    const table = (content[content.length - 1] as { table: { body: TableCell[][] } }).table;
    table.body.slice(1).forEach((row, i) => {
      row[1] = { text: summary.risk_analysis![i].severity, bold: true, color: severityColor(summary.risk_analysis![i].severity), fontSize: 8.5 };
    });
  }

  if (summary.go_no_go) {
    const g = summary.go_no_go;
    content.push(
      h1('4. Go / no-go'),
      { text: g.decision, bold: true, fontSize: 13, color: decisionColor(g.decision), margin: [0, 0, 0, 4] },
      ...bullets('Reasons', g.reasons),
      ...(g.checks.length ? [h2('Checks'), grid(['Criterion', 'Status', 'Evidence'], [130, 55, '*'], g.checks.map((c) => [c.criterion, c.status, c.evidence]))] : []),
    );
  }

  if (summary.contradictions) {
    content.push(h1('5. Contradiction check'));
    content.push(
      summary.contradictions.length
        ? grid(['Conflict', 'Evidence', 'Action'], ['*', '*', 110], summary.contradictions.map((c) => [c.finding, c.evidence, c.action]))
        : { text: 'No conflicts identified in the supplied files.', margin: [0, 0, 0, 4] },
      ...bullets('Missing information / limits', summary.missing_information),
    );
  }

  content.push(...bullets('Watch out for', summary.risks));
  if (summary.recommendation) content.push(h1('Recommendation'), { text: summary.recommendation });

  return {
    info: { title: `Tender analysis – ${title}`, author: 'Diwakar Solar Management Suite' },
    pageSize: 'A4',
    pageMargins: [40, 40, 40, 50],
    defaultStyle: { font: 'Roboto', fontSize: 9.5, color: INK, lineHeight: 1.2 },
    styles: {
      title: { fontSize: 17, bold: true },
      h1: { fontSize: 12.5, bold: true, color: INK },
      h2: { fontSize: 10, bold: true, color: '#334155' },
    },
    content,
    // A heading with nothing below it on its page moves to the next page. The
    // footer counts as "following" but is laid out apart, above this point.
    pageBreakBefore: (node, q) =>
      Boolean(node.headlineLevel) && !q.getFollowingNodesOnPage().some((n) => n.startPosition.top > node.startPosition.top),
    footer: (page: number, pages: number) => ({
      columns: [
        { text: 'AI-generated analysis — verify cited clauses and page numbers against the tender documents before bidding.', fontSize: 7, color: MUTED },
        { text: `Page ${page} of ${pages}`, fontSize: 7, color: MUTED, alignment: 'right', width: 70 },
      ],
      margin: [40, 18, 40, 0],
    }),
  };
}

const fileName = (title: string) => `Tender analysis - ${title.replace(/[^\w.\-() ]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'tender'}.pdf`;

export async function downloadAnalysisPdf(summary: TenderAiSummary, fields: AiFields | null | undefined, title: string) {
  const [pdfModule, vfsModule] = await Promise.all([import('pdfmake/build/pdfmake'), import('pdfmake/build/vfs_fonts')]);
  // Both are CommonJS builds: the API sits on `default` once bundled.
  const pdfMake = ((pdfModule as unknown as { default?: typeof pdfModule }).default ?? pdfModule) as typeof pdfModule;
  const vfs = ((vfsModule as unknown as { default?: unknown }).default ?? vfsModule) as Parameters<typeof pdfModule.addVirtualFileSystem>[0];
  pdfMake.addVirtualFileSystem(vfs);
  // pdfmake lays out the document by rewriting it in place: a list's strings
  // become layout objects. Hand it copies, or the analysis on screen (the
  // same arrays, held in the query cache) turns into objects React cannot draw.
  const doc = buildAnalysisPdf(structuredClone(summary), fields ? structuredClone(fields) : fields, title);
  await pdfMake.createPdf(doc).download(fileName(title));
}
