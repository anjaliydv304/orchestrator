import * as fs from 'node:fs';
import * as path from 'node:path';

function executeAgent(agent) {
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve({
        agentId: agent.agentId,
        agentName: agent.agentName,
        result: `Completed task: ${agent.taskAssigned}`
      });
    }, Math.random() * 1000 + 500); 
  });
}

async function runWorkflow() {
  const agentsFilePath = path.join(process.cwd(), 'agents.json');
  const outputFilePath = path.join(process.cwd(), 'output.json');

  let agentData;
  try {
    agentData = JSON.parse(fs.readFileSync(agentsFilePath, 'utf-8'));
  } catch (error) {
    console.error('Error reading agents.json:', error.message);
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
    const readyAgents = agents.filter(agent => !executedAgents.has(agent.agentId) && isAgentReady(agent));

    if (readyAgents.length === 0) {
      console.error('No ready agents found. There may be a circular dependency.');
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

    for (const group in groups) {
      const agentsInGroup = groups[group];
      const results = await Promise.all(agentsInGroup.map(agent => executeAgent(agent)));
      results.forEach(result => {
        executionResults[result.agentId] = result;
        executedAgents.add(result.agentId);
        console.log(`Executed Agent ${result.agentId}: ${result.agentName}`);
      });
    }
  }

  const finalOutput = {
    mainTask,
    results: executionResults
  };

  try {
    fs.writeFileSync(outputFilePath, JSON.stringify(finalOutput, null, 2), 'utf-8');
    console.log(`Final workflow output saved successfully to ${outputFilePath}`);
  } catch (error) {
    console.error('Error writing output.json:', error.message);
  }
}

runWorkflow();
