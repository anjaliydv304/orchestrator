const standardAgents = {
  RESEARCHER: {
    type: "researcher",
    systemInstruction: `You are a research agent specialized in information gathering and analysis.
Your task is to find, analyze, and synthesize information on the given topic.
Focus on being thorough, accurate, and objective in your research.
Present your findings in a clear, structured manner.`,
    tools: ["webSearch", "documentRetrieval"]
  },
  PLANNER: {
    type: "planner",
    systemInstruction: `You are a planning agent specialized in breaking down complex tasks and creating execution plans.
Your task is to analyze the given objective and create a detailed, step-by-step plan.
Consider dependencies, potential challenges, and resource requirements.
Present your plan in a clear, actionable format.`,
    tools: ["taskDecomposition", "dependencyAnalysis"]
  },
  EXECUTOR: {
    type: "executor",
    systemInstruction: `You are an execution agent. Your task is to perform the assigned subtask precisely as instructed.
Focus on delivering the correct output based on the input and task description.`,
    tools: []
  },
  EVALUATOR: {
    type: "evaluator",
    systemInstruction: `You are an evaluation agent. Your task is to assess the quality, accuracy, and completeness of a given result or task output.
Provide a detailed evaluation based on predefined criteria or the original task requirements.
Offer constructive feedback and a quantifiable score if applicable.`,
    tools: []
  },
  GENERAL: {
    type: "general",
    systemInstruction: `You are a general-purpose AI agent. Your task is to understand and execute the given subtask to the best of your ability.
Provide a clear and concise result.`,
    tools: []
  }
};

export function getAgentByType(type) {
  const agentTypeUpper = type.toUpperCase();
  if (standardAgents[agentTypeUpper]) {
    return standardAgents[agentTypeUpper];
  }
  console.warn(`Agent type "${type}" not found in registry. Falling back to GENERAL.`);
  return standardAgents.GENERAL;
}

export function matchAgentToTask(taskDescription) {
  if (!taskDescription) return "GENERAL";
  const taskLower = taskDescription.toLowerCase();

  if (taskLower.includes("research") || taskLower.includes("find information") || taskLower.includes("gather data")) {
    return "RESEARCHER";
  }
  if (taskLower.includes("plan") || taskLower.includes("schedule") || taskLower.includes("organize tasks") || taskLower.includes("break down")) {
    return "PLANNER";
  }
  if (taskLower.includes("evaluate") || taskLower.includes("assess quality") || taskLower.includes("review result")) {
    return "EVALUATOR";
  }
  if (taskLower.includes("execute") || taskLower.includes("perform") || taskLower.includes("implement") || taskLower.includes("run task")) {
    return "EXECUTOR";
  }
  return "GENERAL";
}