#!/usr/bin/env node
// Usage: node scripts/test-export-proposal.js <proposal_id> [output.docx]
// Example: node scripts/test-export-proposal.js 123 out.docx

import fs from 'fs';
import http from 'http';
import https from 'https';

async function run() {
  const [, , id, outFile = 'proposal-out.docx'] = process.argv;
  if (!id) {
    console.error('Usage: node scripts/test-export-proposal.js <proposal_id> [output.docx]');
    process.exit(2);
  }

  const url = `http://localhost:3000/api/proposals/export?id=${encodeURIComponent(id)}`;
  console.log('Fetching', url);

  const lib = url.startsWith('https') ? https : http;

  lib.get(url, (res) => {
    console.log('Status:', res.statusCode);
    console.log('Content-Type:', res.headers['content-type']);
    console.log('Content-Disposition:', res.headers['content-disposition']);

    const writeStream = fs.createWriteStream(outFile);
    res.pipe(writeStream);
    writeStream.on('finish', () => {
      console.log('Saved to', outFile);
      // print first 200 bytes as a quick check
      const head = fs.readFileSync(outFile).slice(0, 200);
      console.log('First bytes (utf8):', head.toString('utf8'));
      process.exit(0);
    });
  }).on('error', (err) => {
    console.error('Request failed', err);
    process.exit(1);
  });
}

run();
