import { GoogleGenerativeAI } from "@google/generative-ai";
import * as fs from "node:fs";
import dotenv from "dotenv";
import * as path from "node:path";
dotenv.config();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const executionModel = genAI.getGenerativeModel({
  model: "gemini-1.5-flash",
  systemInstruction: `You are an agent executor. Perform the assigned subtask and provide your result in raw JSON format.
Return a JSON with a single key "result" containing your output.`
});

async function executeAgent(agent, context = {}) {
  const contextString = Object.keys(context).length > 0 ? 
    `Dependency results: ${JSON.stringify(context)}.` : "";
  const prompt = `Execute the following subtask: ${agent.taskAssigned}. ${contextString} Provide your result as raw JSON with a key "result".`;
  
  try {
    const result = await executionModel.generateContent(prompt);
    const rawResponse = await result.response.text();
    const cleanResponse = rawResponse.replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(cleanResponse);
    return {
      agentId: agent.agentId,
      agentName: agent.agentName,
      result: parsed.result || rawResponse 
    };
  } catch (error) {
    console.error(`Error executing agent ${agent.agentId}:`, error.message);
    return {
      agentId: agent.agentId,
      agentName: agent.agentName,
      result: `Error: ${error.message}`
    };
  }
}

async function runWorkflow() {
  const agentsFilePath = path.join(process.cwd(), "agents.json");
  const outputFilePath = path.join(process.cwd(), "output.json");

  let agentData;
  try {
    agentData = JSON.parse(fs.readFileSync(agentsFilePath, "utf-8"));
  } catch (error) {
    console.error("Error reading agents.json:", error.message);
    return;
  }

  const agents = agentData.agents;
  const mainTask = agentData.mainTask;
  const executionResults = {};

  const executedAgents = new Set();

  function isAgentReady(agent) {
    return agent.dependencies.every(dep => executedAgents.has(dep));
  }

  while (executedAgents.size < agents.length) {
   
    const readyAgents = agents.filter(agent => 
      !executedAgents.has(agent.agentId) && isAgentReady(agent)
    );

    if (readyAgents.length === 0) {
      console.error("No ready agents found. There might be a circular dependency.");
      return;
    }

    const groups = {};
    readyAgents.forEach(agent => {
      const group = agent.parallelGroup;
      if (!groups[group]) {
        groups[group] = [];
      }
      groups[group].push(agent);
    });

    for (const groupKey of Object.keys(groups)) {
      const groupAgents = groups[groupKey];
      
      const executionPromises = groupAgents.map(agent => {
        const context = {};
     
        agent.dependencies.forEach(dep => {
          if (executionResults[dep]) {
            context[dep] = executionResults[dep].result;
          }
        });
        return executeAgent(agent, context);
      });
      
      const groupResults = await Promise.all(executionPromises);
      groupResults.forEach(result => {
        executionResults[result.agentId] = result;
        executedAgents.add(result.agentId);
        console.log(`Executed Agent ${result.agentId}: ${result.agentName}`);
      });
    }
  }

  const finalOutput = {
    mainTask,
    agentResults: executionResults
  };

  try {
    fs.writeFileSync(outputFilePath, JSON.stringify(finalOutput, null, 2), "utf-8");
    console.log(`Final workflow output saved successfully to ${outputFilePath}`);
  } catch (error) {
    console.error("Error writing output.json:", error.message);
  }
}

runWorkflow();
