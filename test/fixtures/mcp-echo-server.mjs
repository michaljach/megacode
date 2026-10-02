// Minimal stdio MCP server for tests.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const server = new McpServer({ name: 'echo', version: '1.0.0' }, { instructions: 'Use echo to repeat text.' });
server.registerTool('echo', { description: 'Repeat text', inputSchema: { text: z.string() } }, async ({ text }) => ({
  content: [{ type: 'text', text: `echo: ${text}` }],
}));
server.registerTool('fail', { description: 'Always fails', inputSchema: {} }, async () => ({
  content: [{ type: 'text', text: 'it broke' }],
  isError: true,
}));
server.registerTool('env.read', { description: 'Read an env var', inputSchema: { name: z.string() } }, async ({ name }) => ({
  content: [{ type: 'text', text: process.env[name] ?? '(unset)' }],
}));
await server.connect(new StdioServerTransport());
