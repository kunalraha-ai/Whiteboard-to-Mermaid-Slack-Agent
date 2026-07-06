const { spawn } = require('child_process');

/**
 * MCP (Model Context Protocol) Integration Adapter for FlowForge AI
 *
 * Modular stubs demonstrating the integration pattern for external services.
 * Each function can be wired to a real MCP server by replacing the stub
 * implementation with actual MCP client calls.
 */

/**
 * Call a tool on the Slack MCP server using JSON-RPC over STDIO.
 *
 * @param {string} toolName - The name of the tool to call
 * @param {Object} [args={}] - The arguments to pass to the tool
 * @returns {Promise<Object>} The tool's response result
 */
async function callSlackMCPTool(toolName, args = {}) {
  const command = process.env.SLACK_MCP_COMMAND || 'npx';
  const rawArgs = process.env.SLACK_MCP_ARGS;
  
  let commandArgs = [];
  if (rawArgs) {
    try {
      commandArgs = JSON.parse(rawArgs);
    } catch {
      commandArgs = rawArgs.split(' ');
    }
  } else {
    commandArgs = ['-y', '@chinchillaenterprises/mcp-slack'];
  }

  console.log(`[MCP] Calling tool ${toolName} on server: ${command} ${commandArgs.join(' ')}`);

  return new Promise((resolve, reject) => {
    const child = spawn(command, commandArgs, {
      shell: true,
      env: {
        ...process.env,
        SLACK_BOT_TOKEN: process.env.SLACK_BOT_TOKEN,
        SLACK_TEAM_ID: process.env.SLACK_TEAM_ID
      }
    });

    let stdoutBuffer = '';
    let stderrBuffer = '';

    child.stderr.on('data', (data) => {
      stderrBuffer += data.toString();
    });

    child.stdout.on('data', (data) => {
      stdoutBuffer += data.toString();
      
      try {
        const lines = stdoutBuffer.split('\n');
        for (const line of lines) {
          if (line.trim().startsWith('{')) {
            const response = JSON.parse(line.trim());
            if (response.id === 1) {
              child.kill();
              if (response.error) {
                reject(new Error(`MCP error: ${JSON.stringify(response.error)}`));
              } else {
                resolve(response.result);
              }
              return;
            }
          }
        }
      } catch (err) {
        // Continue buffering if JSON is partial
      }
    });

    child.on('error', (err) => {
      reject(err);
    });

    child.on('close', (code) => {
      if (code !== 0 && code !== null) {
        console.warn(`[MCP] Server process exited with code ${code}. Stderr: ${stderrBuffer}`);
      }
      
      try {
        const lines = stdoutBuffer.split('\n');
        for (const line of lines) {
          if (line.trim().startsWith('{')) {
            const response = JSON.parse(line.trim());
            if (response.id === 1) {
              if (response.error) {
                reject(new Error(`MCP error: ${JSON.stringify(response.error)}`));
              } else {
                resolve(response.result);
              }
              return;
            }
          }
        }
        reject(new Error(`MCP server closed without returning response. Stderr: ${stderrBuffer}`));
      } catch (err) {
        reject(new Error(`MCP server closed with code ${code}. Stderr: ${stderrBuffer}`));
      }
    });

    // Write the JSON-RPC tool call to stdin
    const request = {
      jsonrpc: '2.0',
      method: 'tools/call',
      params: {
        name: toolName,
        arguments: args
      },
      id: 1
    };

    child.stdin.write(JSON.stringify(request) + '\n');
  });
}

/**
 * MCP provider configurations.
 * Maps provider names to their connection config and status.
 */
const MCP_PROVIDERS = {
  notion: { name: 'Notion', enabled: true, status: 'stub' },
  jira: { name: 'Jira', enabled: true, status: 'stub' },
  github: { name: 'GitHub', enabled: true, status: 'stub' },
  confluence: { name: 'Confluence', enabled: true, status: 'stub' },
};

/**
 * Save an architecture document to Notion via MCP.
 *
 * @param {Object} params
 * @param {string} params.title - Document title
 * @param {string} params.mermaidCode - Mermaid diagram source code
 * @param {string} params.analysis - Architecture analysis text
 * @param {string} params.diagramPngPath - Path to the rendered diagram PNG
 * @returns {Promise<Object>} Result with success status and Notion URL
 */
async function saveToNotion({ title, mermaidCode, analysis, diagramPngPath }) {
  try {
    console.log(`[MCP/Notion] Saving architecture document: ${title}`);
    console.log(`[MCP/Notion] Mermaid code length: ${mermaidCode?.length ?? 0} chars`);
    console.log(`[MCP/Notion] Analysis length: ${analysis?.length ?? 0} chars`);
    console.log(`[MCP/Notion] Diagram PNG path: ${diagramPngPath ?? 'N/A'}`);

    // TODO: Replace with actual MCP server call
    // Example real implementation:
    //   const mcpClient = await connectMCP('notion');
    //   const response = await mcpClient.call('notion_create_page', {
    //     parent: { database_id: process.env.NOTION_DATABASE_ID },
    //     properties: { title },
    //     children: [
    //       { type: 'code', code: { language: 'mermaid', content: mermaidCode } },
    //       { type: 'paragraph', paragraph: { text: analysis } },
    //     ],
    //   });
    //   return { success: true, provider: 'notion', url: response.url };

    return {
      success: true,
      provider: 'notion',
      message: 'Architecture document saved to Notion (MCP integration configured).',
      url: 'https://notion.so/placeholder',
    };
  } catch (error) {
    console.error(`[MCP/Notion] Error saving document: ${error.message}`);
    return {
      success: false,
      provider: 'notion',
      message: `Failed to save to Notion: ${error.message}`,
    };
  }
}

/**
 * Create Jira tasks from architecture components via MCP.
 *
 * @param {Object} params
 * @param {Array<{name: string, responsibility: string}>} params.components - Component list
 * @param {string} params.projectKey - Jira project key (e.g. 'FLOW')
 * @returns {Promise<Object>} Result with created task details
 */
async function createJiraTasks({ components, projectKey }) {
  try {
    console.log(`[MCP/Jira] Creating ${components.length} tasks in project ${projectKey}`);

    // TODO: Replace with actual MCP server call
    // Example real implementation:
    //   const mcpClient = await connectMCP('jira');
    //   const tasks = await Promise.all(components.map((comp, i) =>
    //     mcpClient.call('jira_create_issue', {
    //       project: { key: projectKey },
    //       issuetype: { name: 'Task' },
    //       summary: `Implement ${comp.name}`,
    //       description: comp.responsibility,
    //     })
    //   ));

    const tasks = components.map((component, index) => ({
      key: `${projectKey}-${index}`,
      summary: `Implement ${component.name}`,
      description: component.responsibility,
      status: 'To Do',
    }));

    console.log(`[MCP/Jira] Created ${tasks.length} tasks:`);
    tasks.forEach((task) => {
      console.log(`  - ${task.key}: ${task.summary}`);
    });

    return {
      success: true,
      provider: 'jira',
      tasksCreated: tasks.length,
      tasks,
    };
  } catch (error) {
    console.error(`[MCP/Jira] Error creating tasks: ${error.message}`);
    return {
      success: false,
      provider: 'jira',
      message: `Failed to create Jira tasks: ${error.message}`,
    };
  }
}

/**
 * Save a diagram or file to a GitHub repository via MCP.
 *
 * @param {Object} params
 * @param {string} params.repoName - Target repository name
 * @param {string} params.filePath - File path within the repository
 * @param {string} params.content - File content to commit
 * @param {string} params.commitMessage - Git commit message
 * @returns {Promise<Object>} Result with success status and GitHub URL
 */
async function saveToGitHub({ repoName, filePath, content, commitMessage }) {
  try {
    console.log(`[MCP/GitHub] Committing to ${repoName}/${filePath}`);
    console.log(`[MCP/GitHub] Commit message: ${commitMessage}`);
    console.log(`[MCP/GitHub] Content length: ${content?.length ?? 0} chars`);

    // TODO: Replace with actual MCP server call
    // Example real implementation:
    //   const mcpClient = await connectMCP('github');
    //   const response = await mcpClient.call('github_create_or_update_file', {
    //     owner: process.env.GITHUB_OWNER,
    //     repo: repoName,
    //     path: filePath,
    //     message: commitMessage,
    //     content: Buffer.from(content).toString('base64'),
    //   });
    //   return { success: true, provider: 'github', url: response.content.html_url };

    return {
      success: true,
      provider: 'github',
      message: 'Diagram committed to repository.',
      url: 'https://github.com/placeholder',
    };
  } catch (error) {
    console.error(`[MCP/GitHub] Error committing file: ${error.message}`);
    return {
      success: false,
      provider: 'github',
      message: `Failed to commit to GitHub: ${error.message}`,
    };
  }
}

/**
 * Publish content to a Confluence space via MCP.
 *
 * @param {Object} params
 * @param {string} params.spaceKey - Confluence space key
 * @param {string} params.title - Page title
 * @param {string} params.content - Page content (HTML or wiki markup)
 * @returns {Promise<Object>} Result with success status and Confluence URL
 */
async function publishToConfluence({ spaceKey, title, content }) {
  try {
    console.log(`[MCP/Confluence] Publishing "${title}" to space ${spaceKey}`);
    console.log(`[MCP/Confluence] Content length: ${content?.length ?? 0} chars`);

    // TODO: Replace with actual MCP server call
    // Example real implementation:
    //   const mcpClient = await connectMCP('confluence');
    //   const response = await mcpClient.call('confluence_create_page', {
    //     spaceKey,
    //     title,
    //     body: { storage: { value: content, representation: 'storage' } },
    //   });
    //   return { success: true, provider: 'confluence', url: response._links.webui };

    return {
      success: true,
      provider: 'confluence',
      message: 'Published to Confluence.',
      url: 'https://confluence.placeholder',
    };
  } catch (error) {
    console.error(`[MCP/Confluence] Error publishing page: ${error.message}`);
    return {
      success: false,
      provider: 'confluence',
      message: `Failed to publish to Confluence: ${error.message}`,
    };
  }
}

/**
 * Get the health/connection status of all MCP providers.
 *
 * @returns {Promise<Object>} Status object listing all providers and their state
 */
async function getMCPStatus() {
  try {
    console.log('[MCP] Checking provider status...');

    // TODO: Replace with actual MCP server call
    // Example real implementation:
    //   const statuses = await Promise.all(
    //     Object.entries(MCP_PROVIDERS).map(async ([key, config]) => {
    //       const mcpClient = await connectMCP(key);
    //       const ping = await mcpClient.call('ping');
    //       return { ...config, status: ping.ok ? 'connected' : 'error' };
    //     })
    //   );

    const providers = Object.fromEntries(
      Object.entries(MCP_PROVIDERS).map(([key, config]) => [
        key,
        { ...config, status: config.status },
      ])
    );

    console.log('[MCP] Provider statuses:', JSON.stringify(providers, null, 2));

    return {
      success: true,
      timestamp: new Date().toISOString(),
      providers,
    };
  } catch (error) {
    console.error(`[MCP] Error checking status: ${error.message}`);
    return {
      success: false,
      message: `Failed to check MCP status: ${error.message}`,
    };
  }
}

module.exports = {
  MCP_PROVIDERS,
  callSlackMCPTool,
  saveToNotion,
  createJiraTasks,
  saveToGitHub,
  publishToConfluence,
  getMCPStatus,
};
