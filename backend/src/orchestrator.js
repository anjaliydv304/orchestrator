// orchestrator.js (or server.js)
import express from "express";
import { v4 as uuidv4 } from "uuid";
import cors from "cors";
import dotenv from "dotenv";
import path from "node:path";
import fs from "node:fs";


import { decomposeTask, saveJsonToFile } from "./tasks/taskDecomposer.js";
import { executeWorkflow } from "./engine/workflowEngine.js"; 
import { storeTaskEmbeddings, retrieveRelevantContext, getCollectionStats } from "./services/vectorDb.js";
import { AgentEvaluator, SystemEvaluator } from "./evaluation/evaluation.js"; 


dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000; 

app.use(express.json());
app.use(cors());

let tasks = {}; 
let agentStatusByTask = {}; 
let clients = []; 


function sendEvent(res, eventName, data) {
    res.write(`event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`);
}

app.get("/events", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  sendEvent(res, "tasks", Object.values(tasks));
  sendEvent(res, "agents", agentStatusByTask);

  const clientId = uuidv4();
  clients.push({ id: clientId, res });
  console.log(`SSE client ${clientId} connected.`);

  req.on("close", () => {
    clients = clients.filter((c) => c.id !== clientId);
    console.log(`SSE client ${clientId} disconnected.`);
  });
});

function broadcastToAll(eventName, data) {
  clients.forEach(client => sendEvent(client.res, eventName, data));
}

function broadcastTaskUpdate() {
    broadcastToAll("tasks", Object.values(tasks));
}

function broadcastAgentUpdateForTask(taskId) {
    if (agentStatusByTask[taskId]) {
        
        broadcastToAll("agents", agentStatusByTask); // Or broadcastToAll("agents_for_task", { taskId, agents: agentStatusByTask[taskId] });
    }
}
function broadcastSystemStats(stats) {
  broadcastToAll("stats", stats);
}
// --- End SSE Functions ---


// This function now primarily defines the structure for the workflow engine,
// the actual agent instances with their types are created within executeWorkflow.
function generateAgentDefinitionsForWorkflow(decomposition) {
  if (!decomposition.subtasks || !Array.isArray(decomposition.subtasks)) {
    console.error("Invalid decomposition format:", decomposition);
    throw new Error("Invalid decomposition format: 'subtasks' array missing or not an array.");
  }
  const agentDefinitions = decomposition.subtasks.map((subtask) => {
    // Agent type matching can also happen here if needed for the definition,
    // but primary instantiation with type happens in workflowEngine
    // const agentType = matchAgentToTask(subtask.subtaskName); // From agentRegistry
    // const agentTemplate = getAgentByType(agentType); // From agentRegistry

    return {
      agentId: subtask.subtaskId, // This is the subtaskId from decomposition
      // agentName: `${agentType} Agent for ${subtask.subtaskName}`, // Name generation can be more dynamic
      // agentType: agentType, // Matched type
      // systemInstruction: agentTemplate.systemInstruction, // From template
      // tools: agentTemplate.tools, // From template
      taskAssigned: subtask.subtaskName,
      status: "pending", // Initial status
      dependencies: subtask.dependencies,
      parallelGroup: subtask.parallelGroup,
      // Other fields like startTime, endTime, result will be populated by the workflow
    };
  });

  return {
    mainTask: decomposition.taskId, // This is the main task's ID
    agents: agentDefinitions, // These are definitions/configurations for agents
  };
}

class Task {
  constructor(description, priority = "medium", dueDate = null) {
    this.taskId = uuidv4();
    this.description = description;
    this.status = "pending"; 
    this.priority = priority;
    this.dueDate = dueDate;
    this.result = null; // Final result of the main task
    this.decomposition = null; // Store the decomposition structure
    this.agentCount = 0;
    this.evaluations = { agentEvaluations: [], systemEvaluation: null }; // For storing evaluation results
    this.overallScore = null;
    this.createdAt = new Date().toISOString();
    this.updatedAt = new Date().toISOString();
  }
}

async function processAndEvaluateTask(taskInstance) {
  try {
    taskInstance.status = "decomposing";
    taskInstance.updatedAt = new Date().toISOString();
    broadcastTaskUpdate();

    console.log(`[${taskInstance.taskId}] Decomposing task: ${taskInstance.description}`);
    const decompositionResult = await decomposeTask(taskInstance.description); 
    decompositionResult.taskId = taskInstance.taskId; // Ensure taskId is on the decomposition root
    taskInstance.decomposition = decompositionResult;
    taskInstance.agentCount = decompositionResult.subtasks?.length || 0;

    
    console.log(`[${taskInstance.taskId}] Task decomposed. Subtasks: ${taskInstance.agentCount}`);

    taskInstance.status = "in-progress";
    taskInstance.updatedAt = new Date().toISOString();
    broadcastTaskUpdate();

    const agentDefinitions = generateAgentDefinitionsForWorkflow(decompositionResult);
    const agentsFilePath = path.join(process.cwd(), `agents_${taskInstance.taskId}.json`); // Task-specific agent file
    saveJsonToFile(agentDefinitions, agentsFilePath);
    console.log(`[${taskInstance.taskId}] Agent definitions saved to ${agentsFilePath}`);

    agentStatusByTask[taskInstance.taskId] = {}; // Initialize agent status for this task
    agentDefinitions.agents.forEach(ad => {
        agentStatusByTask[taskInstance.taskId][ad.agentId] = {
            ...ad, // Spread initial definition
            status: "pending", 
            result: null,
            startTime: null,
            endTime: null,
        };
    });
    broadcastAgentUpdateForTask(taskInstance.taskId);


    const outputFilePath = path.join(process.cwd(), `output_${taskInstance.taskId}.json`);
    console.log(`[${taskInstance.taskId}] Starting workflow execution...`);

    // Workflow update callback
    const workflowUpdateCallback = (agentUpdate) => {
        // console.log(`[${taskInstance.taskId}] Agent Update for ${agentUpdate.agentId}:`, agentUpdate.status);
        if (!agentStatusByTask[taskInstance.taskId]) agentStatusByTask[taskInstance.taskId] = {};
        agentStatusByTask[taskInstance.taskId][agentUpdate.agentId] = {
            ...(agentStatusByTask[taskInstance.taskId][agentUpdate.agentId] || {}), // Keep existing fields
            ...agentUpdate // Overwrite with new update
        };
        broadcastAgentUpdateForTask(taskInstance.taskId);
    };

    const workflowResult = await executeWorkflow(agentsFilePath, outputFilePath, workflowUpdateCallback);
    taskInstance.result = workflowResult; // Contains agentExecutionReports
    console.log(`[${taskInstance.taskId}] Workflow completed.`);

    taskInstance.status = "evaluating";
    taskInstance.updatedAt = new Date().toISOString();
    broadcastTaskUpdate();

    // --- Evaluation Step ---
    const agentEvaluator = new AgentEvaluator(); // from evaluation.js
    const systemEvaluator = new SystemEvaluator(); // from evaluation.js
    const agentExecutionReports = Object.values(workflowResult.agentExecutionReports || {});


    for (const agentReport of agentExecutionReports) {
        if (agentReport.status === "completed" || agentReport.status === "error") {
            const originalSubtask = taskInstance.decomposition.subtasks.find(st => st.subtaskId === agentReport.agentId);
            if (originalSubtask) {
                 console.log(`[${taskInstance.taskId}] Evaluating agent ${agentReport.agentId}...`);
                const evaluation = await agentEvaluator.evaluateAgent(
                    { 
                        agentId: agentReport.agentId,
                        agentName: agentReport.agentName,
                        agentType: agentReport.agentType,
                        taskAssigned: agentReport.taskAssigned,
                    },
                    agentReport, 
                    { description: taskInstance.description, subtask: originalSubtask } 
                );
                taskInstance.evaluations.agentEvaluations.push({ agentId: agentReport.agentId, evaluation });
            }
        }
    }
    console.log(`[${taskInstance.taskId}] Agent evaluations completed.`);

    // System-Level Evaluation
    const systemEvaluation = await systemEvaluator.evaluateTaskCompletion(taskInstance, taskInstance.evaluations.agentEvaluations.map(e => e.evaluation));
    taskInstance.evaluations.systemEvaluation = systemEvaluation;
    taskInstance.overallScore = systemEvaluation.systemRating;
    console.log(`[${taskInstance.taskId}] System evaluation completed. Overall Score: ${taskInstance.overallScore}`);


    taskInstance.status = workflowResult.status === 'completed_successfully' ? "completed" : "completed_with_errors";
    taskInstance.updatedAt = new Date().toISOString();
    taskInstance.completedAt = new Date().toISOString();

    broadcastTaskUpdate();
    const currentStats = await getCollectionStats(); 
    broadcastSystemStats(currentStats);

    try {
      if (fs.existsSync(agentsFilePath)) fs.unlinkSync(agentsFilePath);
      if (fs.existsSync(outputFilePath)) fs.unlinkSync(outputFilePath); 
    } catch (cleanupError) {
      console.warn(`[${taskInstance.taskId}] Error cleaning up temp files:`, cleanupError.message);
    }

    return taskInstance;

  } catch (error) {
    console.error(`[${taskInstance.taskId}] Error processing task:`, error);
    taskInstance.status = "error";
    taskInstance.result = { error: error.message, details: error.stack };
    taskInstance.updatedAt = new Date().toISOString();
    broadcastTaskUpdate();
    return taskInstance;
  }
}


// --- API Endpoints ---
app.post("/tasks", async (req, res) => {
  const { description, priority, dueDate } = req.body;
  if (!description) {
    return res.status(400).json({ error: "Task description is required" });
  }
  const newTask = new Task(description, priority, dueDate);
  tasks[newTask.taskId] = newTask;
  broadcastTaskUpdate();
  res.status(201).json(newTask);

  processAndEvaluateTask(newTask).then((processedTask) => {
    console.log(`[${processedTask.taskId}] Final status: ${processedTask.status}`);
    
  }).catch(err => {
    console.error(`[${newTask.taskId}] Unhandled promise rejection in processAndEvaluateTask:`, err)
  });
});

app.get("/tasks", (req, res) => {
  res.json(Object.values(tasks));
});

app.get("/tasks/:taskId", (req, res) => {
  const { taskId } = req.params;
  const task = tasks[taskId];
  if (!task) return res.status(404).json({ error: "Task not found" });
  res.json(task);
});

app.get("/tasks/:taskId/agents", (req, res) => {
  const { taskId } = req.params;
  const agentStatuses = agentStatusByTask[taskId];
  if (!agentStatuses) return res.status(404).json({ error: "Agents not found for this task or task not processed yet" });
  res.json(Object.values(agentStatuses)); // Return array of agent statuses
});

// Get agent status for a specific agent in a task
app.get("/tasks/:taskId/agents/:agentId", (req, res) => {
    const { taskId, agentId } = req.params;
    const taskAgents = agentStatusByTask[taskId];
    if (!taskAgents || !taskAgents[agentId]) {
        return res.status(404).json({ error: "Agent not found for this task or task not processed yet" });
    }
    res.json(taskAgents[agentId]);
});


app.put("/tasks/:taskId/status", (req, res) => {
  const { taskId } = req.params;
  const { status } = req.body;
  const task = tasks[taskId];
  if (!task) return res.status(404).json({ error: "Task not found" });

  task.status = status;
  task.updatedAt = new Date().toISOString();
  broadcastTaskUpdate();
  res.json(task);
});

app.delete("/tasks/:taskId", (req, res) => {
  const { taskId } = req.params;
  if (!tasks[taskId]) return res.status(404).json({ error: "Task not found" });

  delete tasks[taskId];
  if (agentStatusByTask[taskId]) delete agentStatusByTask[taskId];

  broadcastTaskUpdate();
  broadcastAgentUpdateForTask(taskId); 
  res.status(200).json({ message: "Task deleted successfully" });
});

app.get("/system/stats", async (req, res) => {
  try {
    const stats = await getCollectionStats(); 
   
    res.json(stats);
  } catch (error) {
    console.error("Error fetching system stats:", error);
    res.status(500).json({ error: "Failed to retrieve system statistics" });
  }
});

// --- Server Start ---
if (process.env.NODE_ENV !== 'test') {
    app.listen(PORT, () => {
        console.log(`Multi-Agent System Orchestrator running on http://localhost:${PORT}`);
        console.log(`SSE endpoint available at http://localhost:${PORT}/events`);
    });
}

export { app }; 