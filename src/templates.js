/**
 * FlowForge AI — Slack Block Kit Templates
 *
 * Every exported function returns a plain array of Block Kit block objects
 * (never wrapped in a message envelope). Text uses `mrkdwn` format and
 * respects Slack's 3 000-char-per-block limit by truncating long lists.
 */

const MAX_LIST_ITEMS = 15;

/**
 * Truncate an array and return a formatted bullet list string.
 * @param {string[]} items
 * @param {number}   [max=MAX_LIST_ITEMS]
 * @returns {string} mrkdwn-formatted bullet list
 */
function bulletList(items, max = MAX_LIST_ITEMS) {
  if (!items) return '';
  if (typeof items === 'string') {
    if (items.includes('\n')) {
      items = items.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
    } else {
      const cleanStr = items.replace(/^[•\-\*\s]+/, '').trim();
      return `• ${cleanStr}`;
    }
  }
  if (!Array.isArray(items)) return '';
  if (items.length === 0) return '';

  const visible = items.slice(0, max);
  const lines = visible.map((i) => {
    if (typeof i === 'object' && i !== null) {
      const nameStr = i.name ? `*${i.name}*` : '';
      const respStr = i.responsibility ? `: ${i.responsibility}` : '';
      let depStr = '';
      if (i.dependencies && i.dependencies.length > 0) {
        const deps = Array.isArray(i.dependencies) ? i.dependencies.join(', ') : i.dependencies;
        depStr = ` _(depends on: ${deps})_`;
      }
      return `${nameStr}${respStr}${depStr}`;
    }
    const itemStr = `${i}`;
    const cleanItem = itemStr.replace(/^[•\-\*\s]+/, '').trim();
    return cleanItem;
  }).map((i) => `• ${i}`);

  if (items.length > max) {
    lines.push(`_...and ${items.length - max} more_`);
  }
  return lines.join('\n');
}

/**
 * Helper — plain mrkdwn section block.
 * @param {string} text
 * @returns {object}
 */
function section(text) {
  return {
    type: 'section',
    text: { type: 'mrkdwn', text },
  };
}

/**
 * Helper — header block.
 * @param {string} text
 * @returns {object}
 */
function header(text) {
  return {
    type: 'header',
    text: { type: 'plain_text', text, emoji: true },
  };
}

/** Reusable divider block. */
const divider = { type: 'divider' };

// ---------------------------------------------------------------------------
// Action buttons shared between analysis & iteration cards
// ---------------------------------------------------------------------------

/**
 * Build the standard set of action buttons.
 * @returns {object} actions block
 */
function actionButtons() {
  return {
    type: 'actions',
    elements: [
      {
        type: 'static_select',
        placeholder: {
          type: 'plain_text',
          text: '⚙️ Choose Action / Export...',
          emoji: true,
        },
        action_id: 'action_select_tool',
        options: [
          {
            text: { type: 'plain_text', text: '📊 Generate PlantUML', emoji: true },
            value: 'action_generate_plantuml',
          },
          {
            text: { type: 'plain_text', text: '🔄 Sequence Diagram', emoji: true },
            value: 'action_generate_sequence',
          },
          {
            text: { type: 'plain_text', text: '☁️ AWS Architecture', emoji: true },
            value: 'action_generate_aws',
          },
          {
            text: { type: 'plain_text', text: '🔒 Security Review', emoji: true },
            value: 'action_security_review',
          },
          {
            text: { type: 'plain_text', text: '💰 Cost Estimate', emoji: true },
            value: 'action_cost_estimate',
          },
          {
            text: { type: 'plain_text', text: '📄 Documentation', emoji: true },
            value: 'action_generate_docs',
          },
        ],
      },
      {
        type: 'static_select',
        placeholder: {
          type: 'plain_text',
          text: '🎨 Choose Color Theme...',
          emoji: true,
        },
        action_id: 'action_select_theme',
        options: [
          {
            text: { type: 'plain_text', text: 'Sleek Dark 🌌', emoji: true },
            value: 'theme_dark',
          },
          {
            text: { type: 'plain_text', text: 'Classic Light ☀️', emoji: true },
            value: 'theme_default',
          },
          {
            text: { type: 'plain_text', text: 'Forest Green 🌲', emoji: true },
            value: 'theme_forest',
          },
          {
            text: { type: 'plain_text', text: 'Hand-drawn Sketch ✏️', emoji: true },
            value: 'theme_handdrawn',
          },
          {
            text: { type: 'plain_text', text: 'Ocean Blue 🌊', emoji: true },
            value: 'theme_neutral',
          },
        ],
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// 1. Main analysis card
// ---------------------------------------------------------------------------

/**
 * Build the primary architecture-analysis response card.
 *
 * @param {object}   opts
 * @param {string[]} opts.services          - Detected service / component names.
 * @param {string[]} opts.missingComponents - Components the architecture lacks.
 * @param {string[]} opts.securityIssues    - Observed security concerns.
 * @param {string[]} opts.suggestions       - Improvement suggestions.
 * @param {string}   opts.mermaidCode       - Generated Mermaid diagram source.
 * @param {string}   opts.diagramType       - e.g. "flowchart", "sequence", etc.
 * @returns {object[]} Block Kit blocks array.
 */
function buildAnalysisCard({
  services = [],
  missingComponents = [],
  securityIssues = [],
  suggestions = [],
  mermaidCode = '',
  diagramType = 'unknown',
  editUrl = undefined,
}) {
  const blocks = [];

  // Header
  blocks.push(header('🏗️ FlowForge AI — Architecture Analysis'));

  // Diagram type
  blocks.push(section(`*Diagram type detected:* \`${diagramType}\``));

  // Services found
  const servicesList =
    services.length > 0
      ? bulletList(services)
      : '_No services detected._';
  blocks.push(section(`*Services found:*\n${servicesList}`));

  blocks.push(divider);

  // Missing components
  const missingText =
    missingComponents.length > 0
      ? bulletList(missingComponents)
      : '✅ None detected';
  blocks.push(section(`*⚠️ Missing Components*\n${missingText}`));

  // Security observations
  const securityText =
    securityIssues.length > 0
      ? bulletList(securityIssues)
      : '✅ Looking good';
  blocks.push(section(`*🔒 Security Observations*\n${securityText}`));

  // Suggestions
  const suggestionsText =
    suggestions.length > 0 ? bulletList(suggestions) : 'None';
  blocks.push(section(`*💡 Suggestions*\n${suggestionsText}`));

  blocks.push(divider);

  // Mermaid code block
  blocks.push(section(`*Mermaid Diagram*\n\`\`\`mermaid\n${mermaidCode}\n\`\`\``));

  blocks.push(divider);

  // Action buttons
  blocks.push(actionButtons());

  if (editUrl) {
    blocks.push(divider);
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: '📝 *Want to make quick edits to this diagram?*',
      },
      accessory: {
        type: 'button',
        text: {
          type: 'plain_text',
          text: 'Open in Playground ↗',
          emoji: true,
        },
        url: editUrl,
        action_id: 'open_playground_link',
      },
    });
  }

  return blocks;
}

// ---------------------------------------------------------------------------
// 2. Simple status message
// ---------------------------------------------------------------------------

/**
 * Build a simple single-section status message.
 *
 * @param {string} emoji - Emoji to prefix.
 * @param {string} text  - Status text.
 * @returns {object[]} Block Kit blocks array.
 */
function buildStatusMessage(emoji, text) {
  return [section(`${emoji} ${text}`)];
}

// ---------------------------------------------------------------------------
// 3. Security review card
// ---------------------------------------------------------------------------

/**
 * Build a security-review output card.
 *
 * @param {object}   opts
 * @param {string[]} opts.vulnerabilities  - List of discovered vulnerabilities.
 * @param {string[]} opts.recommendations  - Recommended mitigations.
 * @param {string}   opts.riskLevel        - One of "critical", "high", "medium", "low".
 * @returns {object[]} Block Kit blocks array.
 */
function buildSecurityReviewCard({
  vulnerabilities = [],
  recommendations = [],
  riskLevel = 'medium',
}) {
  const riskEmoji = {
    critical: '🔴',
    high: '🟠',
    medium: '🟡',
    low: '🟢',
  };

  const emoji = riskEmoji[riskLevel] || '⚪';
  const blocks = [];

  blocks.push(header(`${emoji} Security Review — Risk Level: ${riskLevel.toUpperCase()}`));

  const vulnText =
    vulnerabilities.length > 0
      ? bulletList(vulnerabilities)
      : '✅ No vulnerabilities found';
  blocks.push(section(`*Vulnerabilities*\n${vulnText}`));

  blocks.push(divider);

  const recsText =
    recommendations.length > 0
      ? bulletList(recommendations)
      : '_No additional recommendations._';
  blocks.push(section(`*Recommendations*\n${recsText}`));

  return blocks;
}

// ---------------------------------------------------------------------------
// 4. Cost estimate card
// ---------------------------------------------------------------------------

/**
 * Build a cost-estimate output card.
 *
 * @param {object}   opts
 * @param {string}   opts.totalMonthly - Formatted total, e.g. "$1,234".
 * @param {object[]} opts.breakdown    - Array of { service, cost, notes }.
 * @param {string[]} opts.assumptions  - List of pricing assumptions made.
 * @returns {object[]} Block Kit blocks array.
 */
function buildCostEstimateCard({
  totalMonthly = '$0',
  breakdown = [],
  assumptions = [],
}) {
  const blocks = [];

  blocks.push(header('💰 Estimated Monthly Cost'));

  blocks.push(section(`*Total: ${totalMonthly}/mo*`));

  blocks.push(divider);

  // Breakdown
  if (breakdown.length > 0) {
    const items = breakdown.map(
      (b) => `${b.service}: *${b.cost}* — ${b.notes || ''}`,
    );
    blocks.push(section(`*Breakdown*\n${bulletList(items)}`));
  } else {
    blocks.push(section('*Breakdown*\n_No breakdown available._'));
  }

  blocks.push(divider);

  // Assumptions
  if (assumptions.length > 0) {
    blocks.push(section(`*Assumptions*\n${bulletList(assumptions)}`));
  } else {
    blocks.push(section('*Assumptions*\n_None specified._'));
  }

  return blocks;
}

// ---------------------------------------------------------------------------
// 5. Documentation card
// ---------------------------------------------------------------------------

/**
 * Build a formatted architecture-documentation card.
 *
 * @param {object}   opts
 * @param {string}   opts.overview         - High-level architecture overview.
 * @param {string[]} opts.components       - List of component descriptions.
 * @param {string[]} opts.failurePoints    - Known failure points.
 * @param {string}   opts.scalingStrategy  - Description of scaling approach.
 * @returns {object[]} Block Kit blocks array.
 */
function buildDocumentationCard({
  overview = '',
  components = [],
  failurePoints = [],
  scalingStrategy = '',
}) {
  const blocks = [];

  blocks.push(header('📄 Architecture Documentation'));

  // Overview
  blocks.push(section(`*Overview*\n${overview ? bulletList(overview) : '_No overview provided._'}`));

  blocks.push(divider);

  // Components
  const compText =
    components.length > 0
      ? bulletList(components)
      : '_No components listed._';
  blocks.push(section(`*Components*\n${compText}`));

  blocks.push(divider);

  // Failure points
  const failText =
    failurePoints.length > 0
      ? bulletList(failurePoints)
      : '✅ No known failure points';
  blocks.push(section(`*Failure Points*\n${failText}`));

  blocks.push(divider);

  // Scaling strategy
  blocks.push(
    section(
      `*Scaling Strategy*\n${scalingStrategy ? bulletList(scalingStrategy) : '_No scaling strategy defined._'}`,
    ),
  );

  return blocks;
}

// ---------------------------------------------------------------------------
// 6. Iteration / thread-update card
// ---------------------------------------------------------------------------

/**
 * Build the response card for an in-thread diagram iteration.
 *
 * @param {object}   opts
 * @param {string[]} opts.changelog  - List of changes made.
 * @param {string}   opts.mermaidCode - Updated Mermaid source.
 * @returns {object[]} Block Kit blocks array.
 */
function buildIterationCard({ changelog = [], mermaidCode = '', editUrl = undefined }) {
  const blocks = [];

  blocks.push(header('🔄 Diagram Updated'));

  const changeText =
    changelog.length > 0
      ? bulletList(changelog)
      : '_No changes recorded._';
  blocks.push(section(`*Changelog*\n${changeText}`));

  blocks.push(divider);

  blocks.push(section(`*Updated Mermaid Diagram*\n\`\`\`mermaid\n${mermaidCode}\n\`\`\``));

  blocks.push(divider);

  // Same action buttons as the analysis card
  blocks.push(actionButtons());

  if (editUrl) {
    blocks.push(divider);
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: '📝 *Want to make quick edits to this diagram?*',
      },
      accessory: {
        type: 'button',
        text: {
          type: 'plain_text',
          text: 'Open in Playground ↗',
          emoji: true,
        },
        url: editUrl,
        action_id: 'open_playground_link',
      },
    });
  }

  return blocks;
}

// ---------------------------------------------------------------------------
// 7. Diff / comparison card
// ---------------------------------------------------------------------------

/**
 * Build a card showing differences between two diagram versions.
 *
 * @param {object}   opts
 * @param {string[]} opts.changes - List of human-readable change descriptions.
 * @returns {object[]} Block Kit blocks array.
 */
function buildDiffCard({ changes = [] }) {
  const blocks = [];

  blocks.push(header('🔀 Diagram Comparison'));

  if (changes.length > 0) {
    blocks.push(section(`*Changes*\n${bulletList(changes)}`));
  } else {
    blocks.push(section('_No differences detected._'));
  }

  return blocks;
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  buildAnalysisCard,
  buildStatusMessage,
  buildSecurityReviewCard,
  buildCostEstimateCard,
  buildDocumentationCard,
  buildIterationCard,
  buildDiffCard,
};
