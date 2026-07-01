#!/usr/bin/env node
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const index_js_1 = require("@modelcontextprotocol/sdk/server/index.js");
const stdio_js_1 = require("@modelcontextprotocol/sdk/server/stdio.js");
const types_js_1 = require("@modelcontextprotocol/sdk/types.js");
// Ensure API key is present
const API_KEY = process.env.SOWLEDGER_API_KEY;
if (!API_KEY) {
    console.error("Error: SOWLEDGER_API_KEY environment variable is required.");
    process.exit(1);
}
// Fallback to local if developing, otherwise production
const API_BASE = process.env.SOWLEDGER_API_URL || "https://api.sowledger.com/v1";
const server = new index_js_1.Server({
    name: "sowledger-mcp",
    version: "0.1.0",
}, {
    capabilities: {
        tools: {},
    },
});
// Helper for making API requests
async function fetchApi(endpoint, method = "GET", body) {
    const url = `${API_BASE}${endpoint}`;
    const response = await fetch(url, {
        method,
        headers: {
            "Authorization": `Bearer ${API_KEY}`,
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
        body: body ? JSON.stringify(body) : undefined,
    });
    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`SOWLedger API Error (${response.status}): ${errorText}`);
    }
    return response.json();
}
server.setRequestHandler(types_js_1.ListToolsRequestSchema, async () => {
    return {
        tools: [
            {
                name: "list_projects",
                description: "List all active projects in the SOWLedger workspace.",
                inputSchema: {
                    type: "object",
                    properties: {},
                },
            },
            {
                name: "start_timer",
                description: "Start a new time entry for a project/task.",
                inputSchema: {
                    type: "object",
                    properties: {
                        projectId: { type: "string", description: "The ID of the project" },
                        taskId: { type: "string", description: "Optional task ID" },
                        description: { type: "string", description: "What are you working on?" },
                    },
                    required: ["projectId"],
                },
            },
            {
                name: "stop_timer",
                description: "Stop the currently active time entry.",
                inputSchema: {
                    type: "object",
                    properties: {},
                },
            },
        ],
    };
});
server.setRequestHandler(types_js_1.CallToolRequestSchema, async (request) => {
    try {
        switch (request.params.name) {
            case "list_projects": {
                const data = await fetchApi("/projects");
                return {
                    content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
                };
            }
            case "start_timer": {
                const { projectId, taskId, description } = request.params.arguments;
                const data = await fetchApi("/time-entries", "POST", {
                    projectId,
                    taskId,
                    description,
                    action: "start"
                });
                return {
                    content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
                };
            }
            case "stop_timer": {
                const data = await fetchApi("/time-entries", "POST", {
                    action: "stop"
                });
                return {
                    content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
                };
            }
            default:
                throw new Error(`Unknown tool: ${request.params.name}`);
        }
    }
    catch (error) {
        return {
            content: [{ type: "text", text: `Error: ${error.message}` }],
            isError: true,
        };
    }
});
async function run() {
    const transport = new stdio_js_1.StdioServerTransport();
    await server.connect(transport);
    console.error("SOWLedger MCP Server running on stdio");
}
run().catch((error) => {
    console.error("Fatal error:", error);
    process.exit(1);
});
