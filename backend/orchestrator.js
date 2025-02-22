import express from "express";
import { v4 as uuidv4 } from "uuid";
import cors from "cors";
import dotenv from "dotenv";
import path from "node:path";
import fs from "node:fs";
import { decomposeTask, saveJsonToFile } from "./taskDecomposer.js";
import  generateAgentsFromTasks  from "./dynamicAgentCreator.js";
import { executeWorkflow } from "./workflowEngine.js";
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const app = express();
const PORT = process.env.PORT || 5000;

app.use(express.json());
app.use(cors());

let tasks = [];

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
    
    task.status = "in-progress";

    // Decompose
    const decompositionResult = await decomposeTask(task.description);
    const tasksFilePath = path.join(process.cwd(), "tasks.json");
    saveJsonToFile(decompositionResult, tasksFilePath);
    console.log(`Task decomposed and saved to ${tasksFilePath}`);

    // Create dynamic agents from decomposed tasks
    const agentsFilePath = path.join(process.cwd(), "agents.json");
    generateAgentsFromTasks(tasksFilePath, agentsFilePath);
    console.log(`Dynamic agents created and saved to ${agentsFilePath}`);

    // Execute the workflow engine to process agents
    const outputFilePath = path.join(process.cwd(), "output.json");
    await executeWorkflow(agentsFilePath, outputFilePath);
    console.log(`Workflow executed and output saved to ${outputFilePath}`);

    // Read final output from workflow engine
    const outputData = JSON.parse(fs.readFileSync(outputFilePath, "utf-8"));
    task.result = outputData;
    task.status = "completed";
    console.log(`Task ${task.taskId} completed successfully.`);
    return task;
  } catch (error) {
    console.error(`Error processing task ${task.taskId}:`, error.message);
    task.status = "error";
    task.result = { error: error.message };
    return task;
  }
}

// API endpoint to create a new task
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
});

// fetch all tasks
app.get("/tasks", (req, res) => {
  res.json(tasks);
});

app.listen(PORT, () => {
  console.log(`Orchestrator running on http://localhost:${PORT}`);
});
