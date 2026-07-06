/**
 * FlowForge AI — Configuration & Client Initialization
 *
 * Initializes the Slack Bolt App and Azure OpenAI client from environment variables.
 * All other modules import their clients from here.
 */

require('dotenv').config();
const { App } = require('@slack/bolt');
const { AzureOpenAI } = require('openai');

// ─── Validate Required Environment Variables ───
const REQUIRED_ENV = [
  'SLACK_BOT_TOKEN',
  'SLACK_SIGNING_SECRET',
  'SLACK_APP_TOKEN',
  'AZURE_OPENAI_API_KEY',
  'AZURE_OPENAI_ENDPOINT',
  'AZURE_OPENAI_DEPLOYMENT',
];

for (const key of REQUIRED_ENV) {
  if (!process.env[key]) {
    console.error(`❌ Missing required environment variable: ${key}`);
    console.error(`   Copy .env.example to .env and fill in your credentials.`);
    process.exit(1);
  }
}

// ─── Slack Bolt App ───
// Uses Socket Mode for local dev (no public URL needed).
// Switch to HTTP receiver for production deployment.
// Only initialize when not running unit tests to avoid failing auth.test with mock tokens.
let slackApp = null;
if (process.env.NODE_ENV !== 'test') {
  slackApp = new App({
    token: process.env.SLACK_BOT_TOKEN,
    signingSecret: process.env.SLACK_SIGNING_SECRET,
    appToken: process.env.SLACK_APP_TOKEN,
    socketMode: true,
  });
}

// ─── Azure OpenAI Client ───
const openai = new AzureOpenAI({
  apiKey: process.env.AZURE_OPENAI_API_KEY,
  endpoint: process.env.AZURE_OPENAI_ENDPOINT,
  apiVersion: process.env.AZURE_OPENAI_API_VERSION || '2024-12-01-preview',
  deployment: process.env.AZURE_OPENAI_DEPLOYMENT,
});

// ─── Convenience Exports ───
const DEPLOYMENT = process.env.AZURE_OPENAI_DEPLOYMENT;

module.exports = {
  slackApp,
  openai,
  DEPLOYMENT,
};
