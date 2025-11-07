import { NextResponse } from 'next/server';
import { dbConnect } from '@/utils/database';

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export async function GET(request) {
  try {
    const pool = await dbConnect();
    const url = new URL(request.url);
    const id = url.searchParams.get('id');

    let rows;
    if (id) {
      const [r] = await pool.execute('SELECT * FROM proposals WHERE id = ? LIMIT 1', [id]);
      rows = r;
    } else {
      const [r] = await pool.execute('SELECT * FROM proposals ORDER BY created_at DESC');
      rows = r;
    }

    const fs = await import('fs');
    const path = await import('path');
    const templateCandidate = path.join(process.cwd(), 'public', 'templates', 'proposal_format.docx');
    const templateFallback = path.join(process.cwd(), 'public', 'proposal_format.docx');
    const templatePath = fs.existsSync(templateCandidate) ? templateCandidate : templateFallback;
    const useTemplate = id && fs.existsSync(templatePath);

    // ----------------- DOCX TEMPLATE EXPORT -----------------
    if (useTemplate) {
      try {
        const PizZip = (await import('pizzip')).default || (await import('pizzip'));
        const Docxtemplater = (await import('docxtemplater')).default || (await import('docxtemplater'));

        const content = fs.readFileSync(templatePath);
        const zip = new PizZip(content);
        const doc = new Docxtemplater(zip, { paragraphLoop: true, linebreaks: true });

        const p = (rows && rows[0]) || {};
        const data = {};

        // map fields
        Object.keys(p).forEach((k) => {
          const v = p[k];
          if (v === null || v === undefined) return (data[k] = '');
          if (typeof v === 'object') return (data[k] = Array.isArray(v) ? v : JSON.stringify(v, null, 2));
          const s = String(v);
          if (s.trim().startsWith('{') || s.trim().startsWith('[')) {
            try {
              data[k] = JSON.parse(s);
              return;
            } catch {
              /* not JSON */
            }
          }
          data[k] = s;
        });

        // aliases
        data.proposal_id = data.proposal_id || data.id || '';
        data.proposal_title = data.proposal_title || data.title || '';
        data.client_name = data.client_name || data.client || '';
        data.description = data.description || data.project_description || '';

  // additional aliases for annexure fields requested by UI
  data.scope_of_work = data.scope_of_work || data.scope || data.description || '';
  data.input_document = data.input_document || data.input_documents || data.inputDocument || '';
  data.deliverables = data.deliverables || data.list_of_deliverables || data.list_of_deliverables_plain || '';
  data.software = data.software || '';
  data.duration = data.duration || data.timeline || '';
  data.site_visit = data.site_visit || data.siteVisit || '';
  data.quotation_validity = data.quotation_validity || data.quotationValidity || '';
  data.mode_of_delivery = data.mode_of_delivery || data.modeOfDelivery || '';
  data.revision = data.revision || '';
  data.exclusions = data.exclusions || '';
  data.billing = data.billing || data.billing_and_payment || data.billingAndPayment || '';

        // formatting helpers
        const toDate = (v) => {
          if (!v) return null;
          const d = new Date(v);
          return Number.isNaN(d.getTime()) ? null : d;
        };
        const created = toDate(p.created_at || data.created_at);
        data.created_at_formatted = created
          ? created.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })
          : data.created_at || '';
        data.created_at_date = created
          ? created.toLocaleDateString('en-IN', { dateStyle: 'medium' })
          : data.created_at || '';

        const rawVal = p.proposal_value ?? p.value ?? data.value;
        const currency = p.currency || data.currency || '';
        const formatNumber = (n) => {
          try {
            return new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 }).format(Number(n));
          } catch {
            return String(n);
          }
        };
        const formatCurrency = (n, cur) => {
          try {
            if (cur)
              return new Intl.NumberFormat('en-IN', { style: 'currency', currency: cur }).format(Number(n));
            return formatNumber(n);
          } catch {
            return String(n);
          }
        };
        data.value_number = rawVal ? Number(rawVal) : '';
        data.value_formatted = formatNumber(rawVal);
        data.value_with_currency = formatCurrency(rawVal, currency);

        // arrays for loops and bulleted lists
        const makeArray = (v) => {
          if (v === undefined || v === null) return [];
          if (Array.isArray(v)) return v;
          if (typeof v === 'string') {
            const s = v.trim();
            if (s.startsWith('[') || s.startsWith('{')) {
              try {
                const parsed = JSON.parse(s);
                return Array.isArray(parsed) ? parsed : [parsed];
              } catch {
                /* not JSON */
              }
            }
            return s.split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
          }
          return [String(v)];
        };

        ['disciplines', 'activities', 'list_of_deliverables', 'deliverables', 'documents_list'].forEach((k) => {
          const arr = makeArray(p[k] ?? data[k]);
          data[k] = arr;
          data[`${k}_plain`] = arr.join('\n');
          data[`${k}_bulleted`] = arr.map((i) => `• ${i}`).join('\n');
        });

        // render and return
        doc.render(data);
        const buf = doc.getZip().generate({ type: 'nodebuffer' });

        const headers = {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          'Content-Disposition': `attachment; filename="proposal-${data.proposal_id || data.id || Date.now()}.docx"`,
        };
        return new NextResponse(buf, { headers });
      } catch (e) {
        console.error('Docx template render failed, attempting XML injection', e);

        // fallback: insert values manually
        try {
          const PizZip = (await import('pizzip')).default || (await import('pizzip'));
          const content2 = fs.readFileSync(templatePath);
          const zip2 = new PizZip(content2);
          const docXmlPath = 'word/document.xml';
          let docXml = zip2.file(docXmlPath).asText();

          const escapeXml = (str) =>
            String(str)
              .replace(/&/g, '&amp;')
              .replace(/</g, '&lt;')
              .replace(/>/g, '&gt;')
              .replace(/"/g, '&quot;')
              .replace(/'/g, '&#039;');

          const insertParagraph = (text) =>
            `</w:p><w:p><w:r><w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p>`;

          const headingMap = {
            'Proposal': 'proposal_title',
            'Proposal Title': 'proposal_title',
            'Client': 'client_name',
            'Client Name': 'client_name',
            'Scope of Work:': 'description',
            'Deliverables:': 'list_of_deliverables_bulleted',
            'Duration:': 'duration',
            'Quotation Validity:': 'quotation_validity',
            'Payment terms:': 'payment_terms',
            'Mode of Delivery:': 'mode_of_delivery',
            'Value:': 'value_with_currency',
          };

          // add mappings for requested annexure fields
          Object.assign(headingMap, {
            'Scope of Work': 'scope_of_work',
            'Scope of Work:': 'scope_of_work',
            'Input Document:': 'input_document',
            'Input Document': 'input_document',
            'Software:': 'software',
            'Software': 'software',
            'Site Visit:': 'site_visit',
            'Site Visit': 'site_visit',
            'Revision:': 'revision',
            'Revision': 'revision',
            'Exclusions:': 'exclusions',
            'Exclusions': 'exclusions',
            'Billing:': 'billing',
            'Billing': 'billing',
            'Deliverables:': 'deliverables',
          });

          Object.keys(headingMap).forEach((heading) => {
            const key = headingMap[heading];
            const val = data[key] || '';
            if (!val) return;
            const idx = docXml.indexOf(heading);
            if (idx === -1) return;
            const paraClose = docXml.indexOf('</w:p>', idx);
            if (paraClose === -1) return;
            docXml =
              docXml.slice(0, paraClose + 6) + insertParagraph(val) + docXml.slice(paraClose + 6);
          });

          zip2.file(docXmlPath, docXml);
          const modifiedBuf = zip2.generate({ type: 'nodebuffer' });
          const headers = {
            'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'Content-Disposition': `attachment; filename="proposal-${data.proposal_id || Date.now()}.docx"`,
          };
          return new NextResponse(modifiedBuf, { headers });
        } catch (e2) {
          console.error('XML injection fallback failed', e2);
        }
      }
    }

    // ----------------- HTML FALLBACK EXPORT -----------------
    let html = `<!doctype html><html><head><meta charset="utf-8"><title>Proposals export</title>`;
    html += `<style>body{font-family:Arial,Helvetica,sans-serif;font-size:12px}h1{font-size:18px}table{border-collapse:collapse;width:100%;margin-bottom:18px}td,th{border:1px solid #ddd;padding:6px;vertical-align:top}</style>`;
    html += `</head><body>`;
    html += `<h1>Proposals Export (${rows.length})</h1>`;

    rows.forEach((p, idx) => {
      html += `<h2>Proposal ${idx + 1}: ${escapeHtml(p.proposal_title || p.title || p.proposal_id || '')}</h2>`;
      html += `<table>`;
      Object.keys(p).forEach((f) => {
        const val = p[f];
        let out = '';
        if (val === null || val === undefined) out = '';
        else if (typeof val === 'object') out = escapeHtml(JSON.stringify(val, null, 2));
        else if (String(val).trim().startsWith('{') || String(val).trim().startsWith('[')) {
          try {
            out = escapeHtml(JSON.stringify(JSON.parse(val), null, 2));
          } catch {
            out = escapeHtml(String(val));
          }
        } else out = escapeHtml(String(val));
        html += `<tr><th style="width:220px;text-align:left;background:#f3f4f6">${escapeHtml(
          f
        )}</th><td>${out.replace(/\n/g, '<br/>')}</td></tr>`;
      });
      html += `</table>`;
    });

    html += `</body></html>`;

    const headers = {
      'Content-Type': 'application/msword; charset=utf-8',
      'Content-Disposition': `attachment; filename="proposals-${Date.now()}.doc"`,
    };
    return new NextResponse(html, { headers });
  } catch (err) {
    console.error('Proposals export failed', err);
    return NextResponse.json({ success: false, error: 'Failed to export proposals' }, { status: 500 });
  }
}