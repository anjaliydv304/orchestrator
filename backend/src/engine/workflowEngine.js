import { GoogleGenerativeAI } from "@google/generative-ai";
import * as fs from "node:fs";
import dotenv from "dotenv";

import { retrieveRelevantContext, storeExecutionResults, generateEmbedding } from "../services/vectorDb.js";
import { AgentMemory } from "../memory/memory.js";
import { ModelContextProtocol } from "../engine/mcp.js";
import { executeToolCall, getToolByName, formatToolsForLLM } from "../tools/tool.js";
import { getAgentByType, matchAgentToTask } from "../agents/agentRegistry.js";

dotenv.config();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
// This global `executionModel` might be better initialized per agent or passed to MCP

class DynamicAgent {
  constructor(agentConfig, globalExecutionModel) {
    this.agentId = agentConfig.agentId;
    this.agentName = agentConfig.agentName;
    this.agentType = agentConfig.agentType || "GENERAL";
    this.systemInstruction = agentConfig.systemInstruction;
    this.tools = agentConfig.tools || [];
    this.taskAssigned = agentConfig.taskAssigned;
    this.status = "pending";
    this.dependencies = agentConfig.dependencies || [];
    this.parallelGroup = agentConfig.parallelGroup;
    this.startTime = null;
    this.endTime = null;
    this.result = null;
    this.agentStats = { executionTimeMs: 0, toolCallsMade: 0, tokensUsed: 0 };

    this.memory = new AgentMemory(this.agentId);

    const llmTools = this.tools.length > 0 ? formatToolsForLLM(this.tools) : undefined;

    const agentSpecificModel = globalExecutionModel || genAI.getGenerativeModel({
        model: agentConfig.modelName || "gemini-1.5-flash-latest",
        systemInstruction: this.systemInstruction,
    });

    this.mcp = new ModelContextProtocol(agentSpecificModel, {
      systemInstruction: this.systemInstruction,
      tools: llmTools ? [{ functionDeclarations: llmTools }] : undefined,
      modelSettings: agentConfig.modelSettings || { temperature: 0.5, maxOutputTokens: 2048 }
    });
  }

  async execute(context = {}, updateCallback) {
    this.startTime = new Date().toISOString();
    this.status = "in-progress";
    if (updateCallback) updateCallback({ agentId: this.agentId, status: this.status, startTime: this.startTime });

    let agentResultData = {
      reasoning: "Execution started.",
      result: null,
      toolsUsed: [],
    };

    try {
      const vectorDbContext = await retrieveRelevantContext(this.taskAssigned);
      this.memory.addToShortTerm('vector_db_context', vectorDbContext);

      const relevantLongTermMemories = await this.memory.retrieveFromLongTerm(this.taskAssigned, 5);
      this.memory.addToShortTerm('retrieved_long_term_memories', relevantLongTermMemories);

      this.mcp.addToContext("system", `You are a ${this.agentType} agent named ${this.agentName}. Your current task is: ${this.taskAssigned}.`);
      if (Object.keys(context).length > 0) {
        this.mcp.addToContext("system", `Results from dependent tasks: ${JSON.stringify(context)}`);
      }
      if (vectorDbContext && (vectorDbContext.similarTasks?.length || vectorDbContext.similarExecutions?.length)) {
        this.mcp.addToContext("system", `Relevant information from knowledge base: ${JSON.stringify(vectorDbContext).substring(0,1000)}...`);
      }
      if (relevantLongTermMemories && relevantLongTermMemories.length > 0) {
        this.mcp.addToContext("system", `Relevant memories from past executions: ${JSON.stringify(relevantLongTermMemories).substring(0,1000)}...`);
      }

      let currentPrompt = `Execute the subtask: "${this.taskAssigned}". Please provide your reasoning and the final result. If you need to use a tool, call it according to the available tool specifications.`;
      let llmResponse = await this.mcp.generateResponse(currentPrompt);
      let maxToolCallLoops = 5;
      let loopCount = 0;

      while (llmResponse && llmResponse.toolCalls && loopCount < maxToolCallLoops) {
        loopCount++;
        this.agentStats.toolCallsMade += llmResponse.toolCalls.length;
        agentResultData.toolsUsed = agentResultData.toolsUsed || [];

        const toolExecutionPromises = llmResponse.toolCalls.map(async (toolCall) => {
            const toolName = toolCall.name;
            const toolParams = toolCall.args || toolCall.parameters;

            console.log(`Agent ${this.agentId} calling tool: ${toolName} with params:`, toolParams);
            const toolResult = await executeToolCall(toolName, toolParams);
            agentResultData.toolsUsed.push({ tool: toolName, params: toolParams, result: toolResult });
            return {
                functionResponse: {
                    name: toolName,
                    response: toolResult
                }
            };
        });

        const toolResponses = await Promise.all(toolExecutionPromises);
        this.mcp.addToContext("tool", JSON.stringify(toolResponses.map(tr => tr.functionResponse)));
        currentPrompt = "Tools have been executed. Based on their results, please provide your final answer to the original subtask, or call another tool if necessary.";
        llmResponse = await this.mcp.generateResponse(currentPrompt, true);
      }

      if (llmResponse && llmResponse.toolCalls && loopCount >= maxToolCallLoops) {
          console.warn(`Agent ${this.agentId} reached max tool call loops.`);
          agentResultData.reasoning = "Reached maximum tool call iterations. Providing best effort response.";
          this.mcp.addToContext("system", "Max tool call limit reached. Provide your best final answer without calling more tools.");
          llmResponse = await this.mcp.generateResponse("Provide your final answer now.", true);
      }

      if (typeof llmResponse === 'object' && llmResponse !== null && !llmResponse.toolCalls) {
        agentResultData.reasoning = llmResponse.reasoning || agentResultData.reasoning || "Completed.";
        agentResultData.result = llmResponse.result || llmResponse;
      } else if (typeof llmResponse === 'string') {
        agentResultData.result = llmResponse;
        agentResultData.reasoning = agentResultData.reasoning || "Completed.";
      } else {
        agentResultData.result = llmResponse;
        agentResultData.reasoning = agentResultData.reasoning || "Execution finished with non-standard response.";
      }

      this.status = "completed";
      this.result = agentResultData.result;
      console.log(`Agent ${this.agentId} completed. Result:`, this.result);

    } catch (error) {
      console.error(`Error executing agent ${this.agentId} (${this.agentName}):`, error);
      this.status = "error";
      agentResultData.reasoning = `Execution failed: ${error.message}`;
      agentResultData.result = { error: error.message, details: error.stack };
      this.result = agentResultData.result;
    } finally {
      this.endTime = new Date().toISOString();
      this.agentStats.executionTimeMs = new Date(this.endTime).getTime() - new Date(this.startTime).getTime();

      const finalAgentReport = {
        agentId: this.agentId,
        agentName: this.agentName,
        agentType: this.agentType,
        taskAssigned: this.taskAssigned,
        status: this.status,
        startTime: this.startTime,
        endTime: this.endTime,
        executionTimeMs: this.agentStats.executionTimeMs,
        ...agentResultData,
      };

      await storeExecutionResults(this.agentId, finalAgentReport);

      if (this.status === "completed" && finalAgentReport.result) {
        await this.memory.addToLongTerm(
          { task: this.taskAssigned, result: finalAgentReport.result, reasoning: finalAgentReport.reasoning },
          { type: "successful_execution", executionTime: this.agentStats.executionTimeMs }
        );
      } else if (this.status === "error") {
         await this.memory.addToLongTerm(
          { task: this.taskAssigned, error: finalAgentReport.result },
          { type: "failed_execution", executionTime: this.agentStats.executionTimeMs }
        );
      }

      if (updateCallback) updateCallback(finalAgentReport);
      return finalAgentReport;
    }
  }
}

export async function executeWorkflow(agentsFilePath, outputFilePath, updateCallback) {
  let agentInputData;
  try {
    agentInputData = JSON.parse(fs.readFileSync(agentsFilePath, "utf-8"));
  } catch (error) {
    console.error("Error reading agents file:", error.message);
    throw error;
  }

  const mainTaskId = agentInputData.mainTask;
  const subtaskConfigs = agentInputData.agents;

  const agents = subtaskConfigs.map((subtaskConfig) => {
    const agentType = matchAgentToTask(subtaskConfig.taskAssigned);
    const agentTemplate = getAgentByType(agentType);

    const dynamicAgentConfig = {
      agentId: subtaskConfig.agentId,
      agentName: `${agentTemplate.type} Agent for "${subtaskConfig.taskAssigned.substring(0, 30)}..."`,
      agentType: agentTemplate.type,
      systemInstruction: agentTemplate.systemInstruction,
      tools: agentTemplate.tools,
      taskAssigned: subtaskConfig.taskAssigned,
      dependencies: subtaskConfig.dependencies,
      parallelGroup: subtaskConfig.parallelGroup,
      // modelName: "gemini-1.5-pro-latest" // Optionally specify a different model for certain agent types
    };
    return new DynamicAgent(dynamicAgentConfig);
  });

  const executionResults = {};
  const completedAgentIds = new Set();
  let workflowInProgress = true;

  if (updateCallback) {
    agents.forEach(agent => updateCallback({
        agentId: agent.agentId, agentName: agent.agentName, agentType: agent.agentType,
        taskAssigned: agent.taskAssigned, status: "pending",
        dependencies: agent.dependencies, parallelGroup: agent.parallelGroup
    }));
  }

  while (workflowInProgress) {
    const agentsReadyToExecute = agents.filter(agent =>
      agent.status === "pending" &&
      agent.dependencies.every(depId => completedAgentIds.has(depId))
    );

    if (agentsReadyToExecute.length === 0 && completedAgentIds.size < agents.length) {
        const pendingAgents = agents.filter(a => !completedAgentIds.has(a.agentId) && a.status !== 'error');
        if (pendingAgents.every(pa => pa.dependencies.some(depId => agents.find(a => a.agentId === depId)?.status === 'error'))) {
            console.error("Workflow stalled due to errors in dependency agents.");
            pendingAgents.forEach(pa => {
                if (pa.status === 'pending') {
                    pa.status = 'blocked_error';
                    if (updateCallback) updateCallback({ agentId: pa.agentId, status: pa.status, result: "Blocked due to dependency error."});
                }
            });
            workflowInProgress = false;
            break;
        } else if (pendingAgents.length > 0) {
            console.error("Workflow deadlock detected or agents not becoming ready. Dependencies:",
                pendingAgents.map(a => ({id: a.agentId, deps: a.dependencies, status: a.status}))
            );
             pendingAgents.forEach(pa => {
                if (pa.status === 'pending') {
                    pa.status = 'stalled';
                     if (updateCallback) updateCallback({ agentId: pa.agentId, status: pa.status, result: "Stalled due to unresolved dependencies."});
                }
            });
            workflowInProgress = false;
            break;
        }
    }

    if (agentsReadyToExecute.length === 0 && completedAgentIds.size === agents.length) {
      workflowInProgress = false;
      break;
    }

    const executionGroups = {};
    agentsReadyToExecute.forEach(agent => {
      const group = agent.parallelGroup || "default_parallel_group";
      if (!executionGroups[group]) executionGroups[group] = [];
      executionGroups[group].push(agent);
    });

    for (const groupName in executionGroups) {
      const groupAgents = executionGroups[groupName];
      const groupPromises = groupAgents.map(agent => {
        const dependencyContext = {};
        agent.dependencies.forEach(depId => {
          dependencyContext[depId] = executionResults[depId]?.result;
        });
        if (updateCallback) updateCallback({ agentId: agent.agentId, status: "ready_to_execute" });
        return agent.execute(dependencyContext, updateCallback)
          .then(result => {
            executionResults[agent.agentId] = result; // Store the full report
            if (result.status === "completed" || result.status === "error") {
              completedAgentIds.add(agent.agentId);
            }
          })
          .catch(error => {
            console.error(`Unhandled error executing agent ${agent.agentId} in group ${groupName}:`, error);
            const errorResult = {
              agentId: agent.agentId, status: "error", result: { error: error.message },
              startTime: agent.startTime || new Date().toISOString(), endTime: new Date().toISOString()
            };
            executionResults[agent.agentId] = errorResult;
            completedAgentIds.add(agent.agentId);
            if (updateCallback) updateCallback(errorResult);
          });
      });
      await Promise.all(groupPromises);
    }

    if (completedAgentIds.size === agents.length) {
      workflowInProgress = false;
    }
  }

  const finalOutput = {
    mainTaskId: mainTaskId,
    status: Object.values(executionResults).some(r => r.status === 'error') ? 'completed_with_errors' : 'completed_successfully',
    agentExecutionReports: executionResults, // Contains all details from each agent
    completedAt: new Date().toISOString(),
  };

  try {
    fs.writeFileSync(outputFilePath, JSON.stringify(finalOutput, null, 2), "utf-8");
    console.log(`Workflow output saved to ${outputFilePath}`);
  } catch (error) {
    console.error("Error writing workflow output file:", error.message);
  }

  return finalOutput;
}

export { DynamicAgent};