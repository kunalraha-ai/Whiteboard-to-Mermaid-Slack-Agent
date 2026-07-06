const { analyzeWhiteboard } = require('./src/vision');
require('dotenv').config();

const token = process.env.SLACK_BOT_TOKEN;

async function downloadSlackFile(urlPrivate) {
  const response = await fetch(urlPrivate, {
    headers: {
      Authorization: `Bearer ${token}`
    }
  });

  if (!response.ok) {
    throw new Error(`Failed to download Slack file: ${response.statusText}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer).toString('base64');
}

async function run() {
  try {
    const listRes = await fetch('https://slack.com/api/files.list', {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });
    const listData = await listRes.json();
    if (!listData.ok) {
      console.error("Slack API error listing files:", listData.error);
      return;
    }
    
    const fileInfo = listData.files.find(f => f.name === 'ai-collab.png');
    if (!fileInfo) {
      console.error("ai-collab.png not found in Slack files");
      return;
    }
    
    console.log(`Downloading ${fileInfo.name}...`);
    const base64Image = await downloadSlackFile(fileInfo.url_private);
    
    console.log("Calling analyzeWhiteboard...");
    const result = await analyzeWhiteboard(base64Image);
    const mermaidCode = result.mermaidCode;

    console.log("\n==================================================");
    console.log("1. RAW MERMAID SYNTAX PRODUCED:");
    console.log("==================================================");
    console.log(mermaidCode);
    console.log("==================================================\n");

    // Construct the URL exactly as in src/renderer.js Strategy B
    const payload = JSON.stringify({
      code: mermaidCode,
      mermaid: { theme: 'dark' },
    });
    const base64Encoded = Buffer.from(payload, 'utf-8').toString('base64');
    const url = `https://mermaid.ink/img/${base64Encoded}`;

    console.log("==================================================");
    console.log("2. CONSTRUCTED MERMAID.INK URL:");
    console.log("==================================================");
    console.log(url);
    console.log("==================================================\n");

    console.log("Testing constructed URL...");
    const res = await fetch(url);
    console.log(`mermaid.ink Status response: ${res.status} ${res.statusText}`);
    
    // Also test raw code base64 url
    const base64Raw = Buffer.from(mermaidCode, 'utf-8').toString('base64');
    const urlRaw = `https://mermaid.ink/img/${base64Raw}`;
    console.log(`Testing raw code base64 URL: ${urlRaw}`);
    const resRaw = await fetch(urlRaw);
    console.log(`Raw code base64 URL status response: ${resRaw.status} ${resRaw.statusText}`);

  } catch (err) {
    console.error("Test failed with error:", err);
  }
}
run();
