/**
 * FlowForge AI — Slack MCP Search Integration
 *
 * This module searches Slack workspace history using the Slack MCP server's
 * search tools. It supports query modifiers (channel, file, date filters)
 * to build targeted search queries.
 */

const { callSlackMCPTool } = require('./mcp');

/**
 * Search Slack workspace message history for past architectural discussions via MCP.
 *
 * @param {string} query - The formatted search query string.
 * @param {Object} [options={}] - Optional search parameters.
 * @param {number} [options.count=5] - Number of results to return.
 * @returns {Promise<Object>} Search results with found, totalResults, matches, and query.
 */
async function searchArchitectureHistory(query, options = {}) {
  try {
    console.log(`[FlowForge Search] Executing MCP search with query: "${query}"`);

    // Call the Slack MCP server's search tool
    const mcpResponse = await callSlackMCPTool('slack_search_messages', {
      query: query,
      count: options.count || 5
    });

    const contentText = mcpResponse.content?.[0]?.text || '';
    let matches = [];

    if (contentText.trim()) {
      try {
        const parsed = JSON.parse(contentText);
        // Handle array responses or wrapped object structures
        if (Array.isArray(parsed)) {
          matches = parsed;
        } else if (parsed && Array.isArray(parsed.messages)) {
          matches = parsed.messages;
        } else if (parsed && Array.isArray(parsed.matches)) {
          matches = parsed.matches;
        }
      } catch (jsonErr) {
        console.warn('[FlowForge Search] Failed to parse search results as JSON. Parsing plain text fallback...');
        // Fallback: If not JSON, it could be a formatted text block of matches.
        // We will parse it line-by-line if possible, but keep matches empty to trigger fallback.
      }
    }

    // Step 4: Handle zero results explicitly
    if (matches.length === 0) {
      return {
        found: false,
        totalResults: 0,
        matches: [],
        query,
        message: 'No matching prior discussion found.'
      };
    }

    // Map matches to a unified structure
    const formattedMatches = matches.map((match) => ({
      text: match.text || match.message || '',
      channel: {
        id: match.channel_id || match.channel?.id || '',
        name: match.channel_name || match.channel?.name || 'unknown-channel'
      },
      user: match.user_id || match.user || '',
      ts: match.ts || match.timestamp || '',
      permalink: match.permalink || ''
    }));

    return {
      found: true,
      totalResults: formattedMatches.length,
      matches: formattedMatches,
      query
    };
  } catch (error) {
    console.error('[FlowForge Search] Error searching messages via MCP:', error.message);
    return {
      found: false,
      totalResults: 0,
      matches: [],
      query,
      message: `No matching prior discussion found (Search error: ${error.message})`
    };
  }
}

/**
 * Build a search query string from components and context modifiers.
 * Supports: in:channel, has:file, before:date, after:date, and exact quotes.
 *
 * @param {string[]} components - Service/component names (e.g. ['PostgreSQL', 'Redis'])
 * @param {Object} [context={}] - Context modifiers
 * @param {string} [context.channel] - Channel name to scope (e.g. 'general')
 * @param {boolean} [context.hasFile=true] - Limit to messages with files
 * @param {string} [context.before] - Date in YYYY-MM-DD format
 * @param {string} [context.after] - Date in YYYY-MM-DD format
 * @returns {string} The constructed search query string.
 */
function buildSearchQuery(components, context = {}) {
  const queryParts = [];

  // Quote exact component phrases and join with OR
  if (components && components.length > 0) {
    const terms = components.map(c => `"${c.trim()}"`);
    queryParts.push(`(${terms.join(' OR ')})`);
  } else {
    queryParts.push('architecture');
  }

  // Scope to the current channel if available
  if (context.channel) {
    // Strip leading hash character if present
    const cleanChannel = context.channel.replace(/^#/, '');
    queryParts.push(`in:${cleanChannel}`);
  }

  // Limit to messages containing files/attachments by default
  if (context.hasFile !== false) {
    queryParts.push('has:file');
  }

  // Optional date modifiers
  if (context.before) {
    queryParts.push(`before:${context.before}`);
  }
  if (context.after) {
    queryParts.push(`after:${context.after}`);
  }

  return queryParts.join(' ');
}

/**
 * Format search results into Slack Block Kit blocks for rich display.
 *
 * @param {Object} searchResult - The result object from searchArchitectureHistory.
 * @returns {Object[]} Array of Slack Block Kit block objects.
 */
function formatSearchResults(searchResult) {
  const blocks = [
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: '🔍 Related Discussions Found',
        emoji: true,
      },
    },
  ];

  // Explicitly handle zero results case
  if (!searchResult.found || !searchResult.matches || searchResult.matches.length === 0) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `_${searchResult.message || 'No matching prior discussion found.'}_`,
      },
    });
    return blocks;
  }

  const displayMatches = searchResult.matches.slice(0, 5);

  for (const match of displayMatches) {
    const snippet = match.text && match.text.length > 200
      ? match.text.substring(0, 200) + '…'
      : match.text || '_No text_';

    const channelName = match.channel?.name || 'unknown-channel';

    const section = {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `>${snippet}\n_#${channelName}_`,
      },
    };

    if (match.permalink) {
      section.accessory = {
        type: 'button',
        text: {
          type: 'plain_text',
          text: 'View Message',
          emoji: true,
        },
        url: match.permalink,
        action_id: `view_message_${match.ts.replace('.', '_')}`,
      };
    }

    blocks.push(section);
    blocks.push({ type: 'divider' });
  }

  blocks.push({
    type: 'context',
    elements: [
      {
        type: 'mrkdwn',
        text: `Found ${searchResult.totalResults} matching results for query: _"${searchResult.query}"_`,
      },
    ],
  });

  return blocks;
}

module.exports = {
  searchArchitectureHistory,
  buildSearchQuery,
  formatSearchResults,
};
