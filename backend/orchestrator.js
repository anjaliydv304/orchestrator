import express from "express";
import { v4 as uuidv4 } from "uuid";
import cors from "cors";
import dotenv from "dotenv";
import path from "node:path";
import fs from "node:fs";
import { decomposeTask, saveJsonToFile } from "./taskDecomposer.js";
import { executeWorkflow } from "./workflowEngine.js";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, "../.env") });

const app = express();
const PORT = process.env.PORT || 5000;

app.use(express.json());
app.use(cors());

let tasks = [];

let clients = [];

// SSE endpoint
app.get("/events", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  res.write(`data: ${JSON.stringify(tasks)}\n\n`);

  const clientId = Date.now();
  const newClient = { id: clientId, res };
  clients.push(newClient);

  req.on("close", () => {
    console.log(`SSE client ${clientId} disconnected`);
    clients = clients.filter((c) => c.id !== clientId);
  });
});

function broadcastUpdate() {
  const data = `data: ${JSON.stringify(tasks)}\n\n`;
  clients.forEach((client) => client.res.write(data));
}


function generateAgentsFromDecomposition(decomposition) {
  if (!decomposition.subtasks || !Array.isArray(decomposition.subtasks)) {
    throw new Error("Invalid decomposition format: 'subtasks' missing.");
  }
  const agents = decomposition.subtasks.map(subtask => ({
    agentId: subtask.subtaskId,
    agentName: `Agent for ${subtask.subtaskName}`,
    taskAssigned: subtask.subtaskName,
    dependencies: subtask.dependencies,
    parallelGroup: subtask.parallelGroup
  }));
  return {
    mainTask: decomposition.mainTask,
    agents: agents
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
  }
}

async function processTask(task) {
  try {
    // Update status in-memory
    task.status = "in-progress";
    broadcastUpdate();

    const decompositionResult = await decomposeTask(task.description);
    // Dump the decomposition result to a file for logging
    const tasksFilePath = path.join(process.cwd(), "tasks.json");
    saveJsonToFile(decompositionResult, tasksFilePath);
    console.log(`Task decomposed and saved to ${tasksFilePath}`);

    const agentsResult = generateAgentsFromDecomposition(decompositionResult);
    // Dump agents data to file
    const agentsFilePath = path.join(process.cwd(), "agents.json");
    saveJsonToFile(agentsResult, agentsFilePath);
    console.log(`Dynamic agents created and saved to ${agentsFilePath}`);

    const outputFilePath = path.join(process.cwd(), "output.json");
    await executeWorkflow(agentsFilePath, outputFilePath);
    console.log(`Workflow executed and output saved to ${outputFilePath}`);

    const workflowResult = JSON.parse(fs.readFileSync(outputFilePath, "utf-8"));
    task.result = workflowResult;
    task.status = "completed";
    console.log(`Task ${task.taskId} completed successfully.`);
    broadcastUpdate();
    return task;
  } catch (error) {
    console.error(`Error processing task ${task.taskId}:`, error.message);
    task.status = "error";
    task.result = { error: error.message };
    broadcastUpdate();
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
    console.log(`Orchestration complete for task ${updatedTask.taskId}: ${updatedTask.status}`);
  });
  broadcastUpdate();
});

app.get("/tasks", (req, res) => {
  res.json(tasks);
});

app.put("/tasks/:taskId/status", (req, res) => {
  const { taskId } = req.params;
  const { status } = req.body;
  const task = tasks.find((t) => t.taskId === taskId);
  if (!task) {
    return res.status(404).json({ error: "Task not found" });
  }
  task.status = status;
  broadcastUpdate();
  res.json(task);
});

app.put("/tasks/:taskId/priority", (req, res) => {
  const { taskId } = req.params;
  const { priority } = req.body;
  const task = tasks.find((t) => t.taskId === taskId);
  if (!task) {
    return res.status(404).json({ error: "Task not found" });
  }
  task.priority = priority;
  broadcastUpdate();
  res.json(task);
});

app.delete("/tasks/:taskId", (req, res) => {
  const { taskId } = req.params;
  const index = tasks.findIndex((t) => t.taskId === taskId);
  if (index === -1) {
    return res.status(404).json({ error: "Task not found" });
  }
  tasks.splice(index, 1);
  broadcastUpdate();
  res.json({ message: "Task deleted successfully" });
});

app.listen(PORT, () => {
  console.log(`Orchestrator running on http://localhost:${PORT}`);
});
