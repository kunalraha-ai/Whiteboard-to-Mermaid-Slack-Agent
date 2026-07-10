# 🏗️ FlowForge AI — Systems Architect Slack Agent

<p align="center">
  <img src="logo.png?v=4" alt="FlowForge AI Logo" width="200" height="200" />
</p>

FlowForge AI is an agentic AI Systems Architect inside Slack. It allows teams to upload whiteboard sketches, notes, or system diagrams directly in Slack channels, translates them into structured digital Mermaid.js layouts, and lets you iteratively edit, audit, and analyze the architecture conversationally.

---

## 1. System Architecture

The following diagram illustrates the complete end-to-end data flow, vision analysis pipeline, rendering cycle, and search indexing model of the FlowForge AI agent:

```mermaid
graph TD
    %% Nodes & Actors
    User([Slack User])
    BoltApp[Bolt JS Application]
    SlackAPI[Slack Web & Socket API]
    AzureOpenAI[Azure OpenAI GPT-5.5 / GPT-4o]
    MermaidChart[Mermaid Chart MCP Server]
    SlackMCP[Slack MCP Server]

    %% Styles & Colors
    classDef actor fill:#f7d7ff,stroke:#a23bb5,color:#111;
    classDef server fill:#d6e4ff,stroke:#3865c9,color:#111;
    classDef ext fill:#d3f9d8,stroke:#2b8a3e,color:#111;
    class User actor;
    class BoltApp server;
    class SlackAPI,AzureOpenAI,MermaidChart,SlackMCP ext;

    %% --- 1. Image Upload Flow ---
    subgraph "📸 Upload & Analysis Pipeline"
        User -->|1. Uploads whiteboard diagram| SlackAPI
        SlackAPI -->|2. Socket Mode event| BoltApp
        BoltApp -->|3. Download file bytes| SlackAPI
        BoltApp -->|4. Single-Pass Vision query| AzureOpenAI
        AzureOpenAI -->|5. Return Mermaid code & JSON analysis| BoltApp
    end

    %% --- 2. Render & Control Deck ---
    subgraph "📐 Render & Layout Engine"
        BoltApp -->|6. Compile code with styling| MermaidChart
        MermaidChart -->|7. SSE Stream response: PNG & Edit URL| BoltApp
        BoltApp -->|8. Upload PNG buffer| SlackAPI
        BoltApp -->|9. Post Block Kit templates & dropdowns| SlackAPI
        SlackAPI -->|10. Render thread control deck| User
    end

    %% --- 3. Interactive Options & Iteration ---
    subgraph "⚙️ Interactive Tools & Themes"
        User -->|11. Select tools or color themes| SlackAPI
        SlackAPI -->|12. Trigger dropdown actions| BoltApp
        BoltApp -->|13. Re-render styling / execute review| MermaidChart
        BoltApp -->|14. Iterative modification query| AzureOpenAI
    end

    %% --- 4. Search Flow ---
    subgraph "🔍 Workspace History Search"
        User -->|15. Ask 'Did we design this before?'| SlackAPI
        SlackAPI -->|16. Trigger search request| BoltApp
        BoltApp -->|17. Scoped RTS API query| SlackMCP
        SlackMCP -->|18. Query message index| SlackAPI
        SlackAPI -->|19. Return matching permalinks| SlackMCP
        SlackMCP -->|20. Return matches| BoltApp
        BoltApp -->|21. Post search summary card| SlackAPI
    end
```

---

## 2. Core Features

* **Single-Pass Vision Pipeline:** Translates hand-drawn whiteboard photos into accurate, digital, and renderable Mermaid.js flowchart code in a single API call (optimized to under 20 seconds).
* **Mermaid Chart Cloud Rendering:** Renders vector diagrams directly in the cloud using the official Mermaid Chart MCP server endpoint.
* **PDF Documentation Generation:** Compiles a professional multi-page PDF document containing system overviews, component catalogs, resilience analysis, scaling strategies, and embeds the rendered diagram PNG. The PDF is uploaded directly to the Slack thread and can be opened natively in Slack's document viewer.
* **Playground Edit Integration:** Adds an **"Open in Playground ↗"** button to let users open and edit diagrams interactively in their browser.
* **Compact Dropdown UI:** Collapses utilities into two sleek dropdown selectors:
  * **Tools:** Generate PlantUML, compile Sequence Diagrams, translate to AWS Architecture, run threat-model Security Reviews, compile Cost Estimates, or compile PDF Documentation.
  * **Color Themes:** Toggle styles instantly (`Sleek Dark 🌌`, `Classic Light ☀️`, `Forest Green 🌲`, `Hand-drawn Sketch ✏️`, and `Ocean Blue 🌊`).
* **Conversational Thread Iterations:** Edit diagrams by typing replies in the thread (e.g. *"add a caching database and color it orange"*). The bot reads the thread history, revises the syntax, and uploads the new PNG.
* **MCP Workspace Search:** Scopes Slack history for past architectural overlaps by querying the Slack MCP server using Slack's Real-Time Search (RTS) API.

---

## 3. Setup & Installation

### Step 1: Environment Configuration
Create a `.env` file in the project root based on `.env.example`:
```bash
cp .env.example .env
```

Define the following environment variables:
```env
# ─── Slack Credentials ───
SLACK_BOT_TOKEN=xoxb-your-bot-token
SLACK_SIGNING_SECRET=your-signing-secret
SLACK_APP_TOKEN=xapp-your-app-level-token
SLACK_TEAM_ID=Tyour-team-id

# ─── Slack MCP Server ───
SLACK_MCP_COMMAND=npx
SLACK_MCP_ARGS=["-y", "@chinchillaenterprises/mcp-slack"]

# ─── Azure OpenAI ───
AZURE_OPENAI_API_KEY=your-api-key
AZURE_OPENAI_ENDPOINT=https://your-endpoint.openai.azure.com/
AZURE_OPENAI_DEPLOYMENT=gpt-5.5
AZURE_OPENAI_API_VERSION=2025-04-01-preview

# ─── Mermaid Chart MCP Server ───
MERMAID_CHART_TOKEN=your-mermaid-chart-api-token

# ─── Server ───
PORT=3000
```

### Step 2: Install Dependencies
Run the installation script:
```bash
npm install
```

### Step 3: Run the Bot
To start the bot in development/Socket Mode:
```bash
npm start
```

### Step 4: Run Tests
To run the local modular test suite offline:
```bash
npm test
```

---

## 4. Usage Guide

1. **Initial Upload:** 
   Upload an image file (`ai-collab.png`, etc.) directly to any channel where the bot is a member. The bot will automatically create a thread, download the image, run the vision pipeline, and post the rendered digital diagram.
2. **Reviewing Layouts:** 
   Use the **"⚙️ Choose Action / Export..."** dropdown menu at the bottom of the card to run a security audit, estimate costs, write architecture documentation, or convert the syntax.
3. **Changing Colors:** 
   Use the **"🎨 Choose Color Theme..."** dropdown to instantly re-theme your diagram. Try `Hand-drawn Sketch ✏️` or `Sleek Dark 🌌`!
4. **Conversational Revisions:** 
   Reply directly inside the Slack thread with instructions like *"Change the DB to RDS and add an Amazon SQS queue before the email service."* The bot will process, re-render, and upload the updated diagram.
5. **Checking History:** 
   Type *"Did we already design a caching gateway before?"* inside the thread, and the bot will fetch workspace history and post links to relevant matches.
