import express from "express";
import { v4 as uuidv4 } from "uuid";
import cors from "cors";
import dotenv from "dotenv";
import path from "node:path";
import fs from "node:fs";
import { decomposeTask, saveJsonToFile } from "./taskDecomposer.js";
import { executeWorkflow } from "./workflowEngine.js";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

app.use(express.json());
app.use(cors());

let tasks = [];
let agentStatus = {}; 

let clients = [];

// SSE endpoint
app.get("/events", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  // Send initial task data
  res.write(`event: tasks\ndata: ${JSON.stringify(tasks)}\n\n`);
  
  // Send initial agent status data if any exists
  if (Object.keys(agentStatus).length > 0) {
    res.write(`event: agents\ndata: ${JSON.stringify(agentStatus)}\n\n`);
  }

  const clientId = Date.now();
  const newClient = { id: clientId, res };
  clients.push(newClient);

  req.on("close", () => {
    console.log(`SSE client ${clientId} disconnected`);
    clients = clients.filter((c) => c.id !== clientId);
  });
});


function broadcastTaskUpdate() {
  const data = `event: tasks\ndata: ${JSON.stringify(tasks)}\n\n`;
  clients.forEach((client) => client.res.write(data));
}

function broadcastAgentUpdate(taskId, agents) {
 
  agentStatus[taskId] = agents;
  
  const data = `event: agents\ndata: ${JSON.stringify(agentStatus)}\n\n`;
  clients.forEach((client) => client.res.write(data));
}

function generateAgentsFromDecomposition(decomposition) {
  if (!decomposition.subtasks || !Array.isArray(decomposition.subtasks)) {
    throw new Error("Invalid decomposition format: 'subtasks' missing.");
  }
  const agents = decomposition.subtasks.map((subtask) => ({
    agentId: subtask.subtaskId,
    agentName: `Agent for ${subtask.subtaskName}`,
    taskAssigned: subtask.subtaskName,
    status: "pending", 
    dependencies: subtask.dependencies,
    parallelGroup: subtask.parallelGroup,
    startTime: null,
    endTime: null,
    result: null,
  }));
  return {
    mainTask: decomposition.taskId,
    agents: agents,
  };
}

class Task {
  constructor(description, priority = "medium", dueDate = null) {
    this.taskId = uuidv4();
    this.description = description;
    this.status = "pending";
    this.priority = priority;
    this.dueDate = dueDate;
    this.result = null;
    this.agentCount = 0; 
  }
}

async function processTask(task) {
  try {
    
    task.status = "in-progress";
    broadcastTaskUpdate();

    const decompositionResult = await decomposeTask(task.description);
   
    const tasksFilePath = path.join(process.cwd(), "tasks.json");
    saveJsonToFile(decompositionResult, tasksFilePath);
    console.log(`Task decomposed and saved to ${tasksFilePath}`);

    const agentsResult = generateAgentsFromDecomposition(decompositionResult);
    
    task.agentCount = agentsResult.agents.length;
    broadcastTaskUpdate();
   
    broadcastAgentUpdate(task.taskId, agentsResult.agents);
    
    const agentsFilePath = path.join(process.cwd(), "agents.json");
    saveJsonToFile(agentsResult, agentsFilePath);
    console.log(`Dynamic agents created and saved to ${agentsFilePath}`);

    const outputFilePath = path.join(process.cwd(), "output.json");
    await executeWorkflow(agentsFilePath, outputFilePath, (agentUpdate) => {
 
      const currentAgents = [...agentStatus[task.taskId]];
      const agentIndex = currentAgents.findIndex(a => a.agentId === agentUpdate.agentId);
      
      if (agentIndex !== -1) {
        currentAgents[agentIndex] = {
          ...currentAgents[agentIndex],
          ...agentUpdate
        };
        
        broadcastAgentUpdate(task.taskId, currentAgents);
      }
    });
    console.log(`Workflow executed and output saved to ${outputFilePath}`);

    const workflowResult = JSON.parse(fs.readFileSync(outputFilePath, "utf-8"));
    task.result = workflowResult;
    task.status = "completed";
    console.log(`Task ${task.taskId} completed successfully.`);
 
    broadcastTaskUpdate();
    
    return task;
  } catch (error) {
    console.error(`Error processing task ${task.taskId}:`, error.message);
    task.status = "error";
    task.result = { error: error.message };
    broadcastTaskUpdate();
    return task;
  }
}

app.post("/tasks", async (req, res) => {
  const { description, priority, dueDate } = req.body;
  if (!description) {
    return res.status(400).json({ error: "Task description is required" });
  }
  const newTask = new Task(description, priority, dueDate);
  tasks.push(newTask);

  res.status(201).json(newTask);

  processTask(newTask).then((updatedTask) => {
    console.log(
      `Orchestration complete for task ${updatedTask.taskId}: ${updatedTask.status}`
    );
  });
  broadcastTaskUpdate();
});

app.get("/tasks", (req, res) => {
  res.json(tasks);
});

app.get("/tasks/:taskId", (req, res) => {
  const { taskId } = req.params;
  const task = tasks.find((t) => t.taskId === taskId);
  
  if (!task) {
    return res.status(404).json({ error: "Task not found" });
  }
  
  res.json(task);
});


app.get("/tasks/:taskId/agents", (req, res) => {
  const { taskId } = req.params;
  const agents = agentStatus[taskId];
  
  if (!agents) {
    return res.status(404).json({ error: "No agents found for this task" });
  }
  
  res.json(agents);
});

app.put("/tasks/:taskId/status", (req, res) => {
  const { taskId } = req.params;
  const { status } = req.body;

  const validStatuses = ["pending", "in-progress", "completed", "error"];
  if (!validStatuses.includes(status)) {
    return res.status(400).json({ error: "Invalid status value" });
  }
  
  const task = tasks.find((t) => t.taskId === taskId);
  if (!task) {
    return res.status(404).json({ error: "Task not found" });
  }
  task.status = status;
  broadcastTaskUpdate();
  res.json(task);
});

app.put("/tasks/:taskId/priority", (req, res) => {
  const { taskId } = req.params;
  const { priority } = req.body;

  const validPriorities = ["low", "medium", "high", "critical"];
  if (!validPriorities.includes(priority)) {
    return res.status(400).json({ error: "Invalid priority value" });
  }
  
  const task = tasks.find((t) => t.taskId === taskId);
  if (!task) {
    return res.status(404).json({ error: "Task not found" });
  }
  task.priority = priority;
  broadcastTaskUpdate();
  res.json(task);
});

app.delete("/tasks/:taskId", (req, res) => {
  const { taskId } = req.params;
  const index = tasks.findIndex((t) => t.taskId === taskId);
  if (index === -1) {
    return res.status(404).json({ error: "Task not found" });
  }

  if (agentStatus[taskId]) {
    delete agentStatus[taskId];
  }
  
  tasks.splice(index, 1);
  broadcastTaskUpdate();

  const data = `event: agents\ndata: ${JSON.stringify(agentStatus)}\n\n`;
  clients.forEach((client) => client.res.write(data));
  
  res.json({ message: "Task deleted successfully" });
});

const server = app.listen(process.env.NODE_ENV === 'test' ? 0 : PORT, () => {
  if (process.env.NODE_ENV !== 'test') {
    console.log(`Orchestrator running on http://localhost:${PORT}`);
  }
});
export default app;
export { server };
export { processTask, Task };