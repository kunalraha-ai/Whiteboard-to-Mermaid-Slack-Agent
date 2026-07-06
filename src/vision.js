/**
 * @fileoverview Core AI Vision & Conversation Module for FlowForge AI.
 *
 * This module powers the multi-pass whiteboard analysis pipeline and all
 * conversational AI features of the FlowForge AI Slack agent. It communicates
 * with Azure OpenAI (GPT-5.5 / GPT-4o) via the `openai` npm package's
 * AzureOpenAI client.
 *
 * Pipeline overview:
 *   1. analyzeWhiteboard  — 3-pass vision pipeline (classify → synthesise → resolve)
 *   2. iterateDiagram     — Threaded conversation-driven diagram updates
 *   3. generateSecurityReview  — Architecture security audit
 *   4. generateCostEstimate    — AWS cost estimation from diagram
 *   5. convertToPlantUML       — Mermaid → PlantUML conversion
 *   6. convertToSequenceDiagram — Flowchart → Sequence diagram conversion
 *   7. generateDocumentation   — Architecture documentation generation
 *
 * @module vision
 */

const { openai, DEPLOYMENT } = require("./config.js");

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build an image_url content block for the Azure OpenAI vision API.
 *
 * @param {string} base64 - Raw base64-encoded image data (no data-URI prefix).
 * @returns {{ type: "image_url", image_url: { url: string, detail: string } }}
 */
function imageContent(base64) {
  return {
    type: "image_url",
    image_url: {
      url: `data:image/png;base64,${base64}`,
      detail: "high",
    },
  };
}

/**
 * Build a text content block.
 *
 * @param {string} text
 * @returns {{ type: "text", text: string }}
 */
function textContent(text) {
  return { type: "text", text };
}

function safeParse(raw) {
  try {
    if (!raw) return null;
    let clean = raw.trim();
    
    // Strip markdown code block wrappers if the model wrapped the JSON
    if (clean.startsWith('```json')) {
      clean = clean.substring(7);
    } else if (clean.startsWith('```')) {
      clean = clean.substring(3);
    }
    
    if (clean.endsWith('```')) {
      clean = clean.substring(0, clean.length - 3);
    }
    
    return JSON.parse(clean.trim());
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. analyzeWhiteboard — Single-Pass Optimized Vision Pipeline
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Analyse a whiteboard / diagram image through a single-pass optimized AI pipeline.
 *
 * @async
 * @param {string} imageBase64 - Base64-encoded PNG/JPEG image of the whiteboard.
 * @returns {Promise<{
 *   mermaidCode: string,
 *   services: string[],
 *   missingComponents: string[],
 *   securityIssues: string[],
 *   suggestions: string[],
 *   boundingBoxes: Array<{ nodeId: string, coords: [number, number, number, number] }>
 * }>} The final analysis object.
 * @throws {Error} If the Azure OpenAI call fails.
 */
async function analyzeWhiteboard(imageBase64) {
  const systemPrompt = `You are FlowForge AI, a senior systems architect and expert diagram-recognition system.
Analyze the provided whiteboard / diagram image and return a comprehensive architectural analysis.

You must return ONLY a valid JSON object with the following structure (do not wrap in markdown fences or include any additional text):
{
  "diagramType": "<flowchart | sequence | architecture | erd | mindmap | other>",
  "mermaidCode": "<complete Mermaid.js flowchart TD code representing the diagram>",
  "services": ["<identified service / component names>"],
  "missingComponents": ["<components that appear implied but are absent from the diagram>"],
  "securityIssues": ["<potential security concerns visible in the architecture>"],
  "suggestions": ["<architectural improvement suggestions>"],
  "boundingBoxes": [
    {
      "nodeId": "<node identifier (short snake_case derived from node label)>",
      "coords": [ymin, xmin, ymax, xmax]
    }
  ]
}

Rules:
1. Identify all services, databases, gateways, clients, and actors in the diagram.
2. Produce syntactically correct and renderable Mermaid.js flowchart TD code representing the diagram.
3. For boundingBoxes.coords, normalize the coordinates to the range 0-1000 (0 = top/left, 1000 = bottom/right) relative to the image borders.
4. Ensure the JSON is valid and can be parsed immediately. Do not include markdown fences like \`\`\`json.`;

  try {
    const start = Date.now();
    console.log('[Vision] Starting Single-Pass Whiteboard Analysis...');
    
    const response = await openai.chat.completions.create({
      model: DEPLOYMENT,
      messages: [
        { role: 'system', content: systemPrompt },
        {
          role: 'user',
          content: [
            textContent('Analyse this whiteboard image and generate the diagram analysis JSON.'),
            imageContent(imageBase64),
          ],
        },
      ],
      max_completion_tokens: 4096,
    });

    console.log(`[Vision] Single-Pass analysis completed in ${((Date.now() - start) / 1000).toFixed(2)}s`);
    
    const result = safeParse(response.choices[0].message.content);
    if (!result) {
      throw new Error('Failed to parse AI response as valid JSON.');
    }
    
    return {
      mermaidCode: result.mermaidCode || '',
      services: result.services || [],
      missingComponents: result.missingComponents || [],
      securityIssues: result.securityIssues || [],
      suggestions: result.suggestions || [],
      boundingBoxes: result.boundingBoxes || [],
    };
  } catch (err) {
    throw new Error(`[FlowForge AI] Vision analysis failed: ${err.message}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. iterateDiagram — Thread-based diagram updates
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Update a Mermaid diagram based on a user's conversational instruction within
 * a Slack thread context.
 *
 * The function sends the current diagram, the full thread history, and the
 * user's latest message to Azure OpenAI and expects an updated Mermaid code
 * block plus a changelog.
 *
 * @async
 * @param {object} params
 * @param {string}  params.currentMermaid  - The current Mermaid.js diagram code.
 * @param {string}  params.userMessage     - The user's latest instruction / request.
 * @param {string}  [params.imageBase64]   - Optional base64-encoded original image.
 * @param {Array<{ role: string, content: string }>} [params.threadHistory=[]]
 *   Prior conversation turns in the thread (role = "user" | "assistant").
 * @returns {Promise<{
 *   mermaidCode: string,
 *   changelog: string,
 *   fullResponse: string
 * }>} The updated diagram, a summary of changes, and the raw response.
 * @throws {Error} If the Azure OpenAI call fails.
 *
 * @example
 *   const updated = await iterateDiagram({
 *     currentMermaid: "flowchart TD\n  A-->B",
 *     userMessage: "Add a cache layer between A and B",
 *     threadHistory: [],
 *   });
 *   console.log(updated.mermaidCode);
 */
async function iterateDiagram({ currentMermaid, userMessage, imageBase64, threadHistory = [] }) {
  const systemPrompt = `You are FlowForge AI, a senior systems architect. Update the Mermaid diagram based on the user's request. Always return the complete updated Mermaid code block inside \`\`\`mermaid\`\`\` fences, followed by a brief changelog of what changed.

Current Mermaid diagram:
\`\`\`mermaid
${currentMermaid}
\`\`\``;

  // Build the messages array
  const messages = [{ role: "system", content: systemPrompt }];

  // Append thread history for conversational context
  for (const msg of threadHistory) {
    messages.push({ role: msg.role, content: msg.content });
  }

  // Build the user turn — optionally include the original image
  const userContent = [];
  userContent.push(textContent(userMessage));
  if (imageBase64) {
    userContent.push(imageContent(imageBase64));
  }
  messages.push({ role: "user", content: userContent });

  let fullResponse;
  try {
    const response = await openai.chat.completions.create({
      model: DEPLOYMENT,
      messages,
      max_completion_tokens: 4096,
    });
    fullResponse = response.choices[0].message.content || "";
  } catch (err) {
    throw new Error(`[FlowForge AI] iterateDiagram failed: ${err.message}`);
  }

  // Extract mermaid code from fenced block
  const mermaidMatch = fullResponse.match(/```mermaid\s*\n([\s\S]*?)```/);
  const mermaidCode = mermaidMatch ? mermaidMatch[1].trim() : currentMermaid;

  // Everything after the closing fence is the changelog
  const changelogStart = fullResponse.lastIndexOf("```") + 3;
  const changelog = fullResponse.slice(changelogStart).trim() || "No changelog provided.";

  return { mermaidCode, changelog, fullResponse };
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. generateSecurityReview — Architecture security audit
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Perform an AI-driven security audit of an architecture described by its
 * Mermaid diagram code.
 *
 * @async
 * @param {string} mermaidCode - The Mermaid.js diagram to audit.
 * @returns {Promise<{
 *   vulnerabilities: string[],
 *   recommendations: string[],
 *   riskLevel: "low" | "medium" | "high" | "critical"
 * }>} Security audit results.
 * @throws {Error} If the Azure OpenAI call fails.
 *
 * @example
 *   const review = await generateSecurityReview(mermaidCode);
 *   console.log(`Risk: ${review.riskLevel}`);
 */
async function generateSecurityReview(mermaidCode) {
  const systemPrompt = `You are FlowForge AI, a senior cloud-security architect.
Analyse the following Mermaid.js architecture diagram for security vulnerabilities.

Return ONLY valid JSON:
{
  "vulnerabilities": ["<specific vulnerability descriptions>"],
  "recommendations": ["<actionable remediation steps>"],
  "riskLevel": "<low | medium | high | critical>"
}

Consider: authentication, encryption, network segmentation, secret management,
OWASP Top 10, data exfiltration paths, single points of failure, and compliance.`;

  try {
    const response = await openai.chat.completions.create({
      model: DEPLOYMENT,
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: `Review this architecture for security issues:\n\n\`\`\`mermaid\n${mermaidCode}\n\`\`\``,
        },
      ],
      max_completion_tokens: 4096,
    });
    const result = safeParse(response.choices[0].message.content);
    return result || { vulnerabilities: [], recommendations: [], riskLevel: "low" };
  } catch (err) {
    throw new Error(`[FlowForge AI] generateSecurityReview failed: ${err.message}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. generateCostEstimate — AWS cost estimation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generate an estimated monthly AWS cost breakdown for an architecture
 * described by its Mermaid diagram code.
 *
 * @async
 * @param {string} mermaidCode - The Mermaid.js diagram to estimate.
 * @returns {Promise<{
 *   totalMonthly: string,
 *   breakdown: Array<{ service: string, cost: string, notes: string }>,
 *   assumptions: string[]
 * }>} Cost estimation results.
 * @throws {Error} If the Azure OpenAI call fails.
 *
 * @example
 *   const estimate = await generateCostEstimate(mermaidCode);
 *   console.log(`Total: ${estimate.totalMonthly}/mo`);
 */
async function generateCostEstimate(mermaidCode) {
  const systemPrompt = `You are FlowForge AI, a senior cloud-cost analyst specialising in AWS.
Analyse the following Mermaid.js architecture diagram and estimate monthly AWS costs.

Return ONLY valid JSON:
{
  "totalMonthly": "<e.g. $1,234.00>",
  "breakdown": [
    {
      "service": "<AWS service name>",
      "cost": "<e.g. $200.00/mo>",
      "notes": "<sizing assumptions, instance types, etc.>"
    }
  ],
  "assumptions": ["<key assumptions made during estimation>"]
}

Use current (2026) AWS pricing. Map each diagram component to the most
appropriate AWS service. State all assumptions clearly.`;

  try {
    const response = await openai.chat.completions.create({
      model: DEPLOYMENT,
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: `Estimate AWS costs for this architecture:\n\n\`\`\`mermaid\n${mermaidCode}\n\`\`\``,
        },
      ],
      max_completion_tokens: 4096,
    });
    const result = safeParse(response.choices[0].message.content);
    return result || { totalMonthly: "N/A", breakdown: [], assumptions: [] };
  } catch (err) {
    throw new Error(`[FlowForge AI] generateCostEstimate failed: ${err.message}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. convertToPlantUML — Mermaid → PlantUML
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Convert a Mermaid.js diagram to PlantUML syntax using AI.
 *
 * @async
 * @param {string} mermaidCode - The Mermaid.js code to convert.
 * @returns {Promise<{ plantumlCode: string }>} The equivalent PlantUML code.
 * @throws {Error} If the Azure OpenAI call fails.
 *
 * @example
 *   const { plantumlCode } = await convertToPlantUML(mermaidCode);
 *   console.log(plantumlCode);
 */
async function convertToPlantUML(mermaidCode) {
  const systemPrompt = `You are FlowForge AI, an expert in diagram description languages.
Convert the provided Mermaid.js diagram into equivalent, valid PlantUML syntax.

Return ONLY valid JSON:
{
  "plantumlCode": "<complete PlantUML code including @startuml / @enduml>"
}

Preserve all labels, relationships, and groupings. Use appropriate PlantUML
element types (component, node, database, queue, etc.) to match the semantics.`;

  try {
    const response = await openai.chat.completions.create({
      model: DEPLOYMENT,
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: `Convert this Mermaid diagram to PlantUML:\n\n\`\`\`mermaid\n${mermaidCode}\n\`\`\``,
        },
      ],
      max_completion_tokens: 4096,
    });
    const result = safeParse(response.choices[0].message.content);
    return result || { plantumlCode: "" };
  } catch (err) {
    throw new Error(`[FlowForge AI] convertToPlantUML failed: ${err.message}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. convertToSequenceDiagram — Flowchart → Sequence diagram
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Convert a Mermaid.js flowchart into a Mermaid.js sequence diagram.
 *
 * The AI infers actors and message flows from the flowchart topology and
 * produces a `sequenceDiagram` block.
 *
 * @async
 * @param {string} mermaidCode - The Mermaid.js flowchart code to convert.
 * @returns {Promise<{ mermaidCode: string }>} The equivalent sequence diagram.
 * @throws {Error} If the Azure OpenAI call fails.
 *
 * @example
 *   const { mermaidCode: seqDiagram } = await convertToSequenceDiagram(flowchartCode);
 *   console.log(seqDiagram);
 */
async function convertToSequenceDiagram(mermaidCode) {
  const systemPrompt = `You are FlowForge AI, an expert in diagram description languages.
Convert the provided Mermaid.js flowchart into an equivalent Mermaid.js sequence diagram.

Return ONLY valid JSON:
{
  "mermaidCode": "<complete Mermaid.js sequenceDiagram code>"
}

Rules:
- Infer actors / participants from the flowchart nodes.
- Infer message flows from the edges and their labels.
- Use proper sequenceDiagram syntax (participant, ->>, -->>).
- Preserve the logical flow and ordering.`;

  try {
    const response = await openai.chat.completions.create({
      model: DEPLOYMENT,
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: `Convert this flowchart to a sequence diagram:\n\n\`\`\`mermaid\n${mermaidCode}\n\`\`\``,
        },
      ],
      max_completion_tokens: 4096,
    });
    const result = safeParse(response.choices[0].message.content);
    return result || { mermaidCode: "" };
  } catch (err) {
    throw new Error(`[FlowForge AI] convertToSequenceDiagram failed: ${err.message}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 7. generateDocumentation — Architecture documentation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generate comprehensive architecture documentation from a Mermaid diagram.
 *
 * @async
 * @param {string} mermaidCode - The Mermaid.js diagram to document.
 * @returns {Promise<{
 *   overview: string,
 *   components: Array<{ name: string, responsibility: string, dependencies: string[] }>,
 *   failurePoints: string,
 *   scalingStrategy: string
 * }>} Generated architecture documentation.
 * @throws {Error} If the Azure OpenAI call fails.
 *
 * @example
 *   const docs = await generateDocumentation(mermaidCode);
 *   console.log(docs.overview);
 */
async function generateDocumentation(mermaidCode) {
  const systemPrompt = `You are FlowForge AI, a senior systems architect and technical writer.
Generate comprehensive architecture documentation from the Mermaid.js diagram.

Return ONLY valid JSON:
{
  "overview": "<2-3 paragraph high-level description of the system>",
  "components": [
    {
      "name": "<component name>",
      "responsibility": "<what this component does>",
      "dependencies": ["<names of components it depends on>"]
    }
  ],
  "failurePoints": "<description of single points of failure and failure modes>",
  "scalingStrategy": "<recommended scaling strategy and considerations>"
}

Be thorough: cover data flows, integration patterns, resilience, and
operational concerns.`;

  try {
    const response = await openai.chat.completions.create({
      model: DEPLOYMENT,
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: `Generate architecture documentation for this diagram:\n\n\`\`\`mermaid\n${mermaidCode}\n\`\`\``,
        },
      ],
      max_completion_tokens: 4096,
    });
    const result = safeParse(response.choices[0].message.content);
    return (
      result || {
        overview: "",
        components: [],
        failurePoints: "",
        scalingStrategy: "",
      }
    );
  } catch (err) {
    throw new Error(`[FlowForge AI] generateDocumentation failed: ${err.message}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
  analyzeWhiteboard,
  iterateDiagram,
  generateSecurityReview,
  generateCostEstimate,
  convertToPlantUML,
  convertToSequenceDiagram,
  generateDocumentation,
};
