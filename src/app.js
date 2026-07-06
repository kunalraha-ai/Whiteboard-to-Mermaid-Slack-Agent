/**
 * FlowForge AI — Main Slack Application Entrypoint
 *
 * Implements:
 *  1. Zero-config photo upload detection (message with image file)
 *  2. Progressive status updates via thread replies
 *  3. Stateless thread-state reconstruction (conversations.replies)
 *  4. Dynamic diagram iteration
 *  5. Block Kit interactive control deck (PlantUML, AWS, Security, Cost, Docs)
 *  6. Workspace search ("did we design something similar?")
 */

const { slackApp, openai, DEPLOYMENT } = require('./config');
const {
  analyzeWhiteboard,
  iterateDiagram,
  generateSecurityReview,
  generateCostEstimate,
  convertToPlantUML,
  convertToSequenceDiagram,
  generateDocumentation
} = require('./vision');
const { renderMermaid, generateTempPath } = require('./renderer');
const {
  buildAnalysisCard,
  buildStatusMessage,
  buildSecurityReviewCard,
  buildCostEstimateCard,
  buildDocumentationCard,
  buildIterationCard
} = require('./templates');
const { searchArchitectureHistory, buildSearchQuery, formatSearchResults } = require('./search');
const { saveToNotion, createJiraTasks } = require('./mcp');
const fs = require('fs');

/**
 * Download a file from Slack using Bot Token auth.
 * @param {string} urlPrivate - URL to download private file bytes
 * @returns {Promise<string>} Base64-encoded file contents
 */
async function downloadSlackFile(urlPrivate) {
  const response = await fetch(urlPrivate, {
    headers: {
      Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}`
    }
  });

  if (!response.ok) {
    throw new Error(`Failed to download Slack file: ${response.statusText}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer).toString('base64');
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Initial Whiteboard Image Upload Handler
// ─────────────────────────────────────────────────────────────────────────────
slackApp.message(async ({ message, client, say }) => {
  // Only handle top-level messages containing files (ignore thread replies here)
  if (message.thread_ts || !message.files || message.files.length === 0) {
    return;
  }

  // Find the first image file (png, jpeg, webp)
  const imageFile = message.files.find(f =>
    ['png', 'jpg', 'jpeg', 'webp'].includes(f.mimetype?.split('/')[1] || '')
  );

  if (!imageFile) {
    return;
  }

  // Acknowledge immediately to prevent Slack retry storm
  handleDiagramUploadInBackground({ message, client, say, imageFile }).catch((err) => {
    console.error('[FlowForge App] Background upload processing error:', err);
  });
});

async function handleDiagramUploadInBackground({ message, client, say, imageFile }) {
  console.log(`📸 Detected diagram upload: ${imageFile.name} in channel ${message.channel}`);

  // Create initial status thread message
  const statusMessage = await say({
    text: '📸 Got it, analyzing the diagram...',
    thread_ts: message.ts,
    blocks: buildStatusMessage('📸', 'Got it, analyzing diagram structure...')
  });

  try {
    // Progressive Update: Downloading
    await client.chat.update({
      channel: message.channel,
      ts: statusMessage.ts,
      text: '🔍 Downloading whiteboard image...',
      blocks: buildStatusMessage('🔍', 'Downloading whiteboard image file from Slack...')
    });

    const base64Image = await downloadSlackFile(imageFile.url_private);

    // Progressive Update: Analysis
    await client.chat.update({
      channel: message.channel,
      ts: statusMessage.ts,
      text: '🧠 Analyzing diagram with Azure OpenAI...',
      blocks: buildStatusMessage('🧠', 'Running system architecture analysis with Azure OpenAI...')
    });

    const analysis = await analyzeWhiteboard(base64Image);

    // Progressive Update: Rendering
    await client.chat.update({
      channel: message.channel,
      ts: statusMessage.ts,
      text: '📐 Rendering digital diagram...',
      blocks: buildStatusMessage('📐', 'Rendering digital diagram PNG...')
    });

    const startRender = Date.now();
    const tempPath = generateTempPath();
    const renderResult = await renderMermaid(analysis.mermaidCode, tempPath);

    if (!renderResult.success) {
      throw new Error(`Rendering failed: ${renderResult.error}`);
    }
    console.log(`[App] Rendering completed in ${((Date.now() - startRender) / 1000).toFixed(2)}s`);

    // Upload rendered PNG to Slack
    const startUpload = Date.now();
    console.log('[App] Starting Slack file upload...');
    const uploadResponse = await client.files.uploadV2({
      channel_id: message.channel,
      thread_ts: message.ts,
      file: fs.readFileSync(tempPath),
      filename: 'architecture-diagram.png',
      title: 'Digital Diagram Layout'
    });
    console.log(`[App] Slack file upload completed in ${((Date.now() - startUpload) / 1000).toFixed(2)}s`);

    // Log raw response object from file upload
    console.log('[Slack Upload] Raw uploadResponse:', JSON.stringify(uploadResponse, null, 2));

    // Safely retrieve the permalink with fallback and clear null-checks
    const fileUrl = uploadResponse?.files?.[0]?.files?.[0]?.permalink || 
                    uploadResponse?.file?.permalink;

    if (!fileUrl) {
      throw new Error(`[FlowForge AI] File upload completed successfully, but the permalink could not be retrieved from the Slack API response. Raw response: ${JSON.stringify(uploadResponse)}`);
    }

    console.log(`[Slack Upload] Successfully obtained file permalink: ${fileUrl}`);

    // Delete local temp file
    try {
      fs.unlinkSync(tempPath);
    } catch (e) {
      console.warn('Could not clean up temp render path:', e);
    }

    // Final response block
    const analysisCard = buildAnalysisCard({
      services: analysis.services,
      missingComponents: analysis.missingComponents,
      securityIssues: analysis.securityIssues,
      suggestions: analysis.suggestions,
      mermaidCode: analysis.mermaidCode,
      diagramType: 'System Flowchart',
      editUrl: renderResult.editUrl
    });

    // Update the progress card to be the final control deck
    await client.chat.update({
      channel: message.channel,
      ts: statusMessage.ts,
      text: '✅ Analysis Complete!',
      blocks: analysisCard
    });

  } catch (error) {
    console.error('Error handling diagram upload:', error);
    if (error.data) {
      console.error('Slack API raw error data:', JSON.stringify(error.data, null, 2));
    }
    await client.chat.update({
      channel: message.channel,
      ts: statusMessage.ts,
      text: '❌ Processing failed.',
      blocks: buildStatusMessage('❌', `Sorry, something went wrong: ${error.message}`)
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Stateful Conversation & History Iteration Handler (Thread Replies)
// ─────────────────────────────────────────────────────────────────────────────
slackApp.message(async ({ message, client, say }) => {
  // Only process thread replies without new files (new files would be a new run)
  if (!message.thread_ts || (message.files && message.files.length > 0)) {
    return;
  }

  // Acknowledge immediately to prevent Slack retry storm
  handleThreadReplyInBackground({ message, client, say }).catch((err) => {
    console.error('[FlowForge App] Background reply processing error:', err);
  });
});

async function handleThreadReplyInBackground({ message, client, say }) {

  // Verify that the thread is a FlowForge thread by checking replies
  const replies = await client.conversations.replies({
    channel: message.channel,
    ts: message.thread_ts
  });

  // Check if our bot is part of this thread
  const hasBotReply = replies.messages.some(m => m.user === client.selfId || m.bot_id);
  if (!hasBotReply) return;

  const userText = message.text;

  // Handle Workspace Search trigger ("didn't we already design something like...")
  if (/similar|designed|before|already|architecture|overlap/i.test(userText)) {
    const status = await say({
      text: '🔍 Searching Slack history for architectural overlap...',
      thread_ts: message.thread_ts,
      blocks: buildStatusMessage('🔍', 'Searching workspace history for overlap...')
    });

    try {
      // Find all components discussed in the current thread to query
      const allText = replies.messages.map(m => m.text).join(' ');
      // Simple regex extraction of component-like names
      const componentMatches = Array.from(allText.matchAll(/[a-zA-Z0-9]+ (?:Database|Service|Cache|Gateway|Queue|Broker)/gi))
        .map(m => m[0].split(' ')[0]);

      // Fetch channel info to get human-readable channel name
      let channelName = null;
      try {
        const channelInfo = await client.conversations.info({ channel: message.channel });
        channelName = channelInfo.channel?.name;
      } catch (channelErr) {
        console.warn('[FlowForge App] Could not fetch channel info for search scoping:', channelErr.message);
      }

      const query = buildSearchQuery(
        componentMatches.length > 0 ? componentMatches : [],
        { channel: channelName }
      );
      const searchResult = await searchArchitectureHistory(query);
      const searchCard = formatSearchResults(searchResult);

      await client.chat.update({
        channel: message.channel,
        ts: status.ts,
        text: '🔍 Workspace history match results:',
        blocks: searchCard
      });
    } catch (err) {
      await client.chat.update({
        channel: message.channel,
        ts: status.ts,
        text: '❌ Search failed.',
        blocks: buildStatusMessage('❌', `Workspace search failed: ${err.message}`)
      });
    }
    return;
  }

  // Otherwise, treat as an architectural iteration request
  const statusMessage = await say({
    text: '🔄 Re-rendering diagram with revisions...',
    thread_ts: message.thread_ts,
    blocks: buildStatusMessage('🔄', 'Updating diagram layout with your changes...')
  });

  try {
    // 1. Reconstruct current state from thread history
    let originalImageBase64 = null;
    let currentMermaid = '';
    const threadHistory = [];

    // Find the original image file
    const rootMessage = replies.messages[0];
    if (rootMessage.files && rootMessage.files.length > 0) {
      const img = rootMessage.files.find(f => ['png', 'jpg', 'jpeg', 'webp'].includes(f.mimetype?.split('/')[1] || ''));
      if (img) {
        originalImageBase64 = await downloadSlackFile(img.url_private);
      }
    }

    // Process all thread messages to extract past states and chat context
    for (const msg of replies.messages) {
      // Extract latest Mermaid code from assistant replies
      if (msg.bot_id || msg.user === client.selfId) {
        const mermaidMatch = msg.text?.match(/```mermaid\n([\s\S]*?)\n```/) ||
                             msg.blocks?.find(b => b.text?.text?.includes('```mermaid'))?.text?.text?.match(/```mermaid\n([\s\S]*?)\n```/);
        if (mermaidMatch) {
          currentMermaid = mermaidMatch[1];
        }
        threadHistory.push({ role: 'assistant', content: msg.text || '' });
      } else {
        threadHistory.push({ role: 'user', content: msg.text || '' });
      }
    }

    if (!currentMermaid) {
      throw new Error("Could not find the current Mermaid syntax in the thread history.");
    }

    // 2. Call Azure OpenAI to process update
    const result = await iterateDiagram({
      currentMermaid,
      userMessage: userText,
      imageBase64: originalImageBase64,
      threadHistory
    });

    // 3. Render updated diagram
    const startRender = Date.now();
    const tempPath = generateTempPath();
    const renderResult = await renderMermaid(result.mermaidCode, tempPath);

    if (!renderResult.success) {
      throw new Error(`Rendering updated diagram failed: ${renderResult.error}`);
    }
    console.log(`[App] Iteration rendering completed in ${((Date.now() - startRender) / 1000).toFixed(2)}s`);

    // 4. Upload updated PNG
    const startUpload = Date.now();
    console.log('[App] Starting iteration Slack file upload...');
    await client.files.uploadV2({
      channel_id: message.channel,
      thread_ts: message.thread_ts,
      file: fs.readFileSync(tempPath),
      filename: 'architecture-diagram-updated.png',
      title: 'Updated Diagram Layout'
    });
    console.log(`[App] Iteration Slack file upload completed in ${((Date.now() - startUpload) / 1000).toFixed(2)}s`);

    fs.unlinkSync(tempPath);

    // 5. Publish iteration card
    const updateCard = buildIterationCard({
      changelog: result.changelog,
      mermaidCode: result.mermaidCode,
      editUrl: renderResult.editUrl
    });

    await client.chat.update({
      channel: message.channel,
      ts: statusMessage.ts,
      text: '✅ Diagram updated!',
      blocks: updateCard
    });

  } catch (error) {
    console.error('Error iterating diagram:', error);
    await client.chat.update({
      channel: message.channel,
      ts: statusMessage.ts,
      text: '❌ Update failed.',
      blocks: buildStatusMessage('❌', `Failed to update diagram: ${error.message}`)
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. Interactive Block Kit Button Actions
// ─────────────────────────────────────────────────────────────────────────────

// Helper: Extract current Mermaid block from message text/blocks
function extractMermaidFromBlocks(message) {
  const match = message.text?.match(/```mermaid\n([\s\S]*?)\n```/);
  if (match) return match[1];

  if (message.blocks) {
    for (const block of message.blocks) {
      const text = block.text?.text || '';
      const blockMatch = text.match(/```mermaid\n([\s\S]*?)\n```/);
      if (blockMatch) return blockMatch[1];
    }
  }
  return null;
}

// Helper action runners for both legacy buttons and new select dropdowns
async function handleSecurityReviewAction({ body, client, respond }) {
  const mermaid = extractMermaidFromBlocks(body.message);
  if (!mermaid) return;

  await respond({
    text: '🛡️ Running automated threat-model security review...',
    response_type: 'in_channel',
    replace_original: false,
    thread_ts: body.message.thread_ts || body.message.ts
  });

  try {
    const review = await generateSecurityReview(mermaid);
    const card = buildSecurityReviewCard(review);
    await client.chat.postMessage({
      channel: body.channel.id,
      thread_ts: body.message.thread_ts || body.message.ts,
      text: `🛡️ Security Review: Risk Level ${review.riskLevel.toUpperCase()}`,
      blocks: card
    });
  } catch (err) {
    await respond({
      text: `❌ Security review failed: ${err.message}`,
      response_type: 'in_channel',
      replace_original: false
    });
  }
}

async function handleCostEstimateAction({ body, client, respond }) {
  const mermaid = extractMermaidFromBlocks(body.message);
  if (!mermaid) return;

  await respond({
    text: '💰 Calculating estimated AWS infrastructure costs...',
    response_type: 'in_channel',
    replace_original: false,
    thread_ts: body.message.thread_ts || body.message.ts
  });

  try {
    const cost = await generateCostEstimate(mermaid);
    const card = buildCostEstimateCard(cost);
    await client.chat.postMessage({
      channel: body.channel.id,
      thread_ts: body.message.thread_ts || body.message.ts,
      text: `💰 Cost Estimation: ~${cost.totalMonthly}/mo`,
      blocks: card
    });
  } catch (err) {
    await respond({
      text: `❌ Cost estimate failed: ${err.message}`,
      response_type: 'in_channel',
      replace_original: false
    });
  }
}

async function handleGenerateDocsAction({ body, client, respond }) {
  const mermaid = extractMermaidFromBlocks(body.message);
  if (!mermaid) return;

  await respond({
    text: '📄 Writing detailed system architecture documentation...',
    response_type: 'in_channel',
    replace_original: false,
    thread_ts: body.message.thread_ts || body.message.ts
  });

  try {
    const docs = await generateDocumentation(mermaid);
    const card = buildDocumentationCard(docs);
    await client.chat.postMessage({
      channel: body.channel.id,
      thread_ts: body.message.thread_ts || body.message.ts,
      text: '📄 System Architecture Documentation',
      blocks: card
    });
  } catch (err) {
    await respond({
      text: `❌ Docs generation failed: ${err.message}`,
      response_type: 'in_channel',
      replace_original: false
    });
  }
}

async function handleGeneratePlantumlAction({ body, client, respond }) {
  const mermaid = extractMermaidFromBlocks(body.message);
  if (!mermaid) return;

  await respond({
    text: '📊 Transpiling diagram to PlantUML syntax...',
    response_type: 'in_channel',
    replace_original: false,
    thread_ts: body.message.thread_ts || body.message.ts
  });

  try {
    const puml = await convertToPlantUML(mermaid);
    await client.chat.postMessage({
      channel: body.channel.id,
      thread_ts: body.message.thread_ts || body.message.ts,
      text: `📊 *PlantUML Representation:*\n\`\`\`\n${puml.plantumlCode}\n\`\`\``
    });
  } catch (err) {
    await respond({
      text: `❌ PlantUML conversion failed: ${err.message}`,
      response_type: 'in_channel',
      replace_original: false
    });
  }
}

async function handleGenerateSequenceAction({ body, client, respond }) {
  const mermaid = extractMermaidFromBlocks(body.message);
  if (!mermaid) return;

  await respond({
    text: '🔄 Remapping architecture flow as a Sequence Diagram...',
    response_type: 'in_channel',
    replace_original: false,
    thread_ts: body.message.thread_ts || body.message.ts
  });

  try {
    const sequence = await convertToSequenceDiagram(mermaid);
    await client.chat.postMessage({
      channel: body.channel.id,
      thread_ts: body.message.thread_ts || body.message.ts,
      text: `🔄 *Sequence Diagram Mermaid:*\n\`\`\`mermaid\n${sequence.mermaidCode}\n\`\`\``
    });
  } catch (err) {
    await respond({
      text: `❌ Sequence diagram generation failed: ${err.message}`,
      response_type: 'in_channel',
      replace_original: false
    });
  }
}

async function handleGenerateAwsAction({ body, client, respond }) {
  const mermaid = extractMermaidFromBlocks(body.message);
  if (!mermaid) return;

  await respond({
    text: '☁️ Translating components to native AWS architectures...',
    response_type: 'in_channel',
    replace_original: false,
    thread_ts: body.message.thread_ts || body.message.ts
  });

  try {
    const result = await iterateDiagram({
      currentMermaid: mermaid,
      userMessage: 'Translate all generic nodes to their exact AWS component equivalents (e.g. queue to SQS, database to RDS PostgreSQL, server to ECS/Lambda, CDN to CloudFront). Maintain the same flow structure.',
      imageBase64: null,
      threadHistory: []
    });

    const tempPath = generateTempPath();
    const renderResult = await renderMermaid(result.mermaidCode, tempPath);

    if (renderResult.success) {
      await client.files.uploadV2({
        channel_id: body.channel.id,
        thread_ts: body.message.thread_ts || body.message.ts,
        file: fs.readFileSync(tempPath),
        filename: 'aws-architecture.png',
        title: 'AWS Compiled Diagram Layout'
      });
      fs.unlinkSync(tempPath);
    }

    await client.chat.postMessage({
      channel: body.channel.id,
      thread_ts: body.message.thread_ts || body.message.ts,
      text: `☁️ *AWS Map Details:*\n${result.changelog}\n\n\`\`\`mermaid\n${result.mermaidCode}\n\`\`\``
    });
  } catch (err) {
    await respond({
      text: `❌ AWS mapping failed: ${err.message}`,
      response_type: 'in_channel',
      replace_original: false
    });
  }
}

// 3.1 Legacy Individual Action Buttons (for backward compatibility)
slackApp.action('action_security_review', async ({ ack, body, client, respond }) => {
  await ack();
  await handleSecurityReviewAction({ body, client, respond });
});

slackApp.action('action_cost_estimate', async ({ ack, body, client, respond }) => {
  await ack();
  await handleCostEstimateAction({ body, client, respond });
});

slackApp.action('action_generate_docs', async ({ ack, body, client, respond }) => {
  await ack();
  await handleGenerateDocsAction({ body, client, respond });
});

slackApp.action('action_generate_plantuml', async ({ ack, body, client, respond }) => {
  await ack();
  await handleGeneratePlantumlAction({ body, client, respond });
});

slackApp.action('action_generate_sequence', async ({ ack, body, client, respond }) => {
  await ack();
  await handleGenerateSequenceAction({ body, client, respond });
});

slackApp.action('action_generate_aws', async ({ ack, body, client, respond }) => {
  await ack();
  await handleGenerateAwsAction({ body, client, respond });
});

// 3.2 Tool Selector Dropdown
slackApp.action('action_select_tool', async ({ ack, body, client, respond }) => {
  await ack();
  const selectedTool = body.actions[0].selected_option.value;

  switch (selectedTool) {
    case 'action_security_review':
      await handleSecurityReviewAction({ body, client, respond });
      break;
    case 'action_cost_estimate':
      await handleCostEstimateAction({ body, client, respond });
      break;
    case 'action_generate_docs':
      await handleGenerateDocsAction({ body, client, respond });
      break;
    case 'action_generate_plantuml':
      await handleGeneratePlantumlAction({ body, client, respond });
      break;
    case 'action_generate_sequence':
      await handleGenerateSequenceAction({ body, client, respond });
      break;
    case 'action_generate_aws':
      await handleGenerateAwsAction({ body, client, respond });
      break;
    default:
      console.warn(`[FlowForge App] Unknown tool action selected: ${selectedTool}`);
  }
});

// 3.3 Color Theme Selector Dropdown
slackApp.action('action_select_theme', async ({ ack, body, client, respond }) => {
  await ack();
  const selectedTheme = body.actions[0].selected_option.value;
  const mermaid = extractMermaidFromBlocks(body.message);
  if (!mermaid) return;

  const themeNames = {
    theme_dark: 'Sleek Dark 🌌',
    theme_default: 'Classic Light ☀️',
    theme_forest: 'Forest Green 🌲',
    theme_handdrawn: 'Hand-drawn Sketch ✏️',
    theme_neutral: 'Ocean Blue 🌊'
  };
  const themeName = themeNames[selectedTheme] || selectedTheme;

  await respond({
    text: `🎨 Changing diagram theme to *${themeName}*...`,
    response_type: 'in_channel',
    replace_original: false,
    thread_ts: body.message.thread_ts || body.message.ts
  });

  try {
    const tempPath = generateTempPath();
    const renderResult = await renderMermaid(mermaid, tempPath, selectedTheme);

    if (!renderResult.success) {
      throw new Error(`Rendering failed: ${renderResult.error}`);
    }

    await client.files.uploadV2({
      channel_id: body.channel.id,
      thread_ts: body.message.thread_ts || body.message.ts,
      file: fs.readFileSync(tempPath),
      filename: `diagram-${selectedTheme.replace('theme_', '')}.png`,
      title: `${themeName} Layout`
    });

    fs.unlinkSync(tempPath);

    await client.chat.postMessage({
      channel: body.channel.id,
      thread_ts: body.message.thread_ts || body.message.ts,
      text: `🎨 *Theme updated successfully to:* ${themeName}`
    });
  } catch (err) {
    await respond({
      text: `❌ Theme change failed: ${err.message}`,
      response_type: 'in_channel',
      replace_original: false
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Server Start & Health Check Handler
// ─────────────────────────────────────────────────────────────────────────────
(async () => {
  // Start Bolt App (Socket Mode starts the WebSocket connection)
  await slackApp.start();
  console.log('⚡ FlowForge AI Socket Mode connection activated.');

  // Start a lightweight HTTP server on process.env.PORT for Render health checks
  const http = require('http');
  const port = process.env.PORT || 3000;
  const server = http.createServer((req, res) => {
    if (req.url === '/' || req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('OK');
    } else {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
    }
  });

  server.listen(port, () => {
    console.log(`📡 Health check server listening on port ${port}`);
  });
})();
