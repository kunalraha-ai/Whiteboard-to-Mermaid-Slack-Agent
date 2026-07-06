const fs = require('fs');
const path = require('path');

/**
 * Valid Mermaid diagram type keywords used for syntax validation.
 * @type {string[]}
 */
const VALID_DIAGRAM_TYPES = [
  'graph',
  'flowchart',
  'sequenceDiagram',
  'classDiagram',
  'stateDiagram',
  'erDiagram',
  'gantt',
  'pie',
  'journey',
  'gitgraph',
];

/**
 * Get the initialization directive string for a specific color theme.
 *
 * @param {string} themeKey - The theme key, e.g. "theme_dark", "theme_default", etc.
 * @returns {string} Mermaid initialization configuration directive
 */
function getThemeDirective(themeKey) {
  switch (themeKey) {
    case 'theme_default':
      return "%%{init: { 'theme': 'default' } }%%";
    case 'theme_forest':
      return "%%{init: { 'theme': 'forest' } }%%";
    case 'theme_handdrawn':
      return "%%{init: { 'theme': 'base', 'themeVariables': { 'fontFamily': 'Comic Sans MS', 'background': '#fffdf5', 'primaryColor': '#fffbe8', 'lineColor': '#5e4831' } } }%%";
    case 'theme_neutral':
      return "%%{init: { 'theme': 'neutral' } }%%";
    case 'theme_dark':
    default:
      return "%%{init: { 'theme': 'dark', 'themeVariables': { 'background': '#1e1e1e', 'primaryColor': '#2d2d2d', 'primaryTextColor': '#ffffff', 'lineColor': '#3897f0', 'signalColor': '#3897f0', 'actorBkg': '#2d2d2d', 'actorBorder': '#555555', 'labelBoxBkgColor': '#2d2d2d', 'labelBoxBorderColor': '#555555' } } }%%";
  }
}

/**
 * Renders Mermaid code to a PNG image file using the official Mermaid Chart MCP server.
 *
 * @param {string} mermaidCode - The Mermaid diagram source code.
 * @param {string} outputPath  - Absolute path where the output PNG should be written.
 * @param {string} [theme=null] - Optional selected color theme identifier.
 * @returns {Promise<{success: boolean, path: string, method: 'mcp', editUrl?: string, error?: string}>}
 *   Result object indicating success/failure, the output path, 'mcp' as the method,
 *   an optional playground edit URL, and an optional error message on failure.
 */
async function renderMermaid(mermaidCode, outputPath, theme = null) {
  console.log('==================================================');
  console.log('[Renderer] Raw Mermaid syntax received:');
  console.log('==================================================');
  console.log(mermaidCode);
  console.log('==================================================');

  const token = process.env.MERMAID_CHART_TOKEN;
  if (!token) {
    console.error('[Renderer] MERMAID_CHART_TOKEN is missing in .env');
    return {
      success: false,
      path: outputPath,
      method: 'mcp',
      error: 'MERMAID_CHART_TOKEN is missing in .env file.'
    };
  }

  const mcpUrl = 'https://mcp.mermaidchart.com/mcp';
  console.log(`[Renderer] Sending render request to Mermaid Chart MCP server at ${mcpUrl}...`);

  try {
    const detectedType = validateMermaidSyntax(mermaidCode).diagramType || 'flowchart';

    // Strip any pre-existing %%{init: ...}%% block and prepend our theme block
    const cleanCode = mermaidCode.replace(/%%\{[\s\S]*?\}%%/g, '').trim();
    const finalCode = getThemeDirective(theme || 'theme_dark') + '\n' + cleanCode;

    const payload = {
      jsonrpc: '2.0',
      method: 'tools/call',
      params: {
        name: 'validate_and_render_mermaid_diagram',
        arguments: {
          prompt: 'Render whiteboard flow diagram from Slack upload',
          mermaidCode: finalCode,
          diagramType: detectedType,
          clientName: 'FlowForge AI'
        }
      },
      id: 1
    };

    const start = Date.now();
    const response = await fetch(mcpUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify(payload)
    });

    const duration = Date.now() - start;
    console.log(`[Renderer] Received response from Mermaid Chart MCP server in ${duration}ms (status: ${response.status})`);

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`HTTP Error ${response.status} ${response.statusText}: ${errText}`);
    }

    const text = await response.text();
    
    // Parse SSE stream text (events are separated by double newlines)
    const events = text.split('\n\n');
    let rpcResponse = null;

    for (const event of events) {
      const lines = event.split('\n');
      let eventType = 'message';
      const dataLines = [];

      for (let line of lines) {
        line = line.trim();
        if (line.startsWith('event:')) {
          eventType = line.substring(6).trim();
        } else if (line.startsWith('data:')) {
          dataLines.push(line.substring(5).trim());
        }
      }

      if (eventType === 'message' && dataLines.length > 0) {
        const joinedData = dataLines.join('\n');
        try {
          const parsed = JSON.parse(joinedData);
          if (parsed && (parsed.result || parsed.error)) {
            rpcResponse = parsed;
            break;
          }
        } catch (parseErr) {
          // Skip if this event segment is not valid JSON-RPC
        }
      }
    }

    if (!rpcResponse) {
      throw new Error(`Could not find a valid JSON-RPC message event in the response event-stream. Raw response: ${text.substring(0, 500)}`);
    }

    if (rpcResponse.error) {
      throw new Error(`JSON-RPC Error: ${JSON.stringify(rpcResponse.error)}`);
    }

    let pngBuffer = null;
    let editUrl = null;

    if (rpcResponse.result && Array.isArray(rpcResponse.result.content)) {
      for (const item of rpcResponse.result.content) {
        if (item.type === 'image' && item.mimeType === 'image/png' && item.data) {
          // Binary block: Base64-encoded PNG image
          pngBuffer = Buffer.from(item.data, 'base64');
        } else if (item.type === 'text' && item.text) {
          // Check if the text is a serialized JSON object (as some tools return)
          try {
            const parsed = JSON.parse(item.text);
            if (parsed.renderedPNG) {
              const b64Data = parsed.renderedPNG.replace(/^data:image\/png;base64,/, '');
              pngBuffer = Buffer.from(b64Data, 'base64');
            }
            if (parsed.liveEditUrl) {
              editUrl = parsed.liveEditUrl;
            }
          } catch {
            // Text fallback: scan for URLs in plaintext description
            if (item.text.includes('http')) {
              const match = item.text.match(/https?:\/\/[^\s]+/);
              if (match) editUrl = match[0];
            }
          }
        }
      }
    }

    if (!pngBuffer) {
      throw new Error('No PNG image data returned in the MCP response.');
    }

    // Ensure the output directory exists
    const outputDir = path.dirname(outputPath);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    fs.writeFileSync(outputPath, pngBuffer);
    console.log(`[Renderer] Render succeeded! Output written to: ${outputPath}`);

    return {
      success: true,
      path: outputPath,
      method: 'mcp',
      editUrl: editUrl || undefined
    };

  } catch (error) {
    console.error('[Renderer] Mermaid Chart MCP render failed:', error.message);
    return {
      success: false,
      path: outputPath,
      method: 'mcp',
      error: error.message
    };
  }
}

/**
 * Validates Mermaid syntax by checking that the code begins with a recognised
 * diagram type keyword.
 *
 * @param {string} mermaidCode - The Mermaid diagram source code to validate.
 * @returns {{valid: boolean, diagramType: string, error?: string}}
 *   Result object indicating whether the syntax is valid, the detected diagram
 *   type (empty string when invalid), and an optional error message.
 */
function validateMermaidSyntax(mermaidCode) {
  if (!mermaidCode || typeof mermaidCode !== 'string') {
    return { valid: false, diagramType: '', error: 'Mermaid code must be a non-empty string.' };
  }

  // Strip frontmatter directives like %%{init: ...}%% and standard %% comments
  const cleanCode = mermaidCode
    .replace(/%%\{[\s\S]*?\}%%/g, '')
    .replace(/%%.*/g, '')
    .trim();

  if (cleanCode.length === 0) {
    return { valid: false, diagramType: '', error: 'Mermaid code is empty after cleaning comments.' };
  }

  const firstToken = cleanCode.split(/[\s\n;]+/)[0];

  const matched = VALID_DIAGRAM_TYPES.find(
    (type) => type.toLowerCase() === firstToken.toLowerCase(),
  );

  if (!matched) {
    return {
      valid: false,
      diagramType: '',
      error: `Unknown diagram type "${firstToken}". Expected one of: ${VALID_DIAGRAM_TYPES.join(', ')}.`,
    };
  }

  return { valid: true, diagramType: matched };
}

/**
 * Generates a unique temporary file path for output PNG images.
 *
 * @returns {string} Absolute path to a uniquely-named `.png` file in the temp directory.
 */
function generateTempPath() {
  const crypto = require('crypto');
  const os = require('os');
  return path.join(os.tmpdir(), `flowforge-render-${crypto.randomUUID()}.png`);
}

module.exports = {
  renderMermaid,
  validateMermaidSyntax,
  generateTempPath,
};
