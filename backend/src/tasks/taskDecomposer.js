import { GoogleGenerativeAI } from "@google/generative-ai";
import * as fs from "node:fs";
import dotenv from "dotenv";
import * as path from "node:path";
import { storeTaskEmbeddings, generateEmbedding } from "../services/vectorDb.js";

dotenv.config();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const decompositionModel = genAI.getGenerativeModel({
  model: "gemini-1.5-flash", 
  systemInstruction: `You are an advanced task decomposition assistant. Break down complex tasks into a series of well-defined, manageable subtasks.
For each main task, provide a JSON object with a 'mainTask' description and a 'subtasks' array.
Each subtask in the array must be an object with the following fields:
- "subtaskId": A unique string identifier for the subtask (e.g., "subtask_1").
- "subtaskName": A concise and actionable description of what the subtask entails.
- "dependencies": An array of "subtaskId" strings that this subtask depends on. Empty if no dependencies.
- "parallelGroup": A string or number indicating a group for parallel execution. Subtasks in the same group can potentially run in parallel if their dependencies are met. (e.g., "groupA", "groupB", or 1, 2).
- "estimatedComplexity": (Optional) A numerical value from 1 (simple) to 5 (complex).
- "description": A more detailed explanation of the subtask, its goals, and expected output.

Example of a subtask:
{
  "subtaskId": "subtask_1",
  "subtaskName": "Gather project requirements",
  "dependencies": [],
  "parallelGroup": "groupA",
  "estimatedComplexity": 2,
  "description": "Collect all necessary requirements from stakeholders, including functional and non-functional specifications."
}

Ensure the output is ONLY a valid JSON object, with no extra text, comments, or markdown.
The 'subtaskId' should be unique within the decomposition.
Dependencies should correctly reflect the logical flow of work.
Think carefully about which tasks can truly run in parallel.`,
});

function cleanJsonResponse(responseText) {
  try {
    const match = responseText.match(/```json\s*([\s\S]*?)\s*```/);
    if (match && match[1]) {
      return JSON.parse(match[1]);
    }
    return JSON.parse(responseText);
  } catch (error) {
    console.error("Error parsing AI response in taskDecomposer:", error.message);
    console.error("Raw response was:", responseText);
    throw new Error("Received invalid JSON from AI for task decomposition.");
  }
}

export async function decomposeTask(mainTaskDescription) {
  try {
    const taskId = `task-${Date.now()}`;
    const prompt = `Decompose the following main task into subtasks according to the specified JSON format: "${mainTaskDescription}"`;

    const result = await decompositionModel.generateContent(prompt);
    const rawResponse = await result.response.text();
    let decompositionResult = cleanJsonResponse(rawResponse);

    if (!decompositionResult.mainTask || !decompositionResult.subtasks) {
        if (!decompositionResult.mainTask && decompositionResult.subtasks) {
            decompositionResult = { mainTask: mainTaskDescription, subtasks: decompositionResult.subtasks };
        } else if (Array.isArray(decompositionResult)) {
            decompositionResult = { mainTask: mainTaskDescription, subtasks: decompositionResult };
        } else {
            console.error("Decomposition output from LLM is not in the expected format:", decompositionResult);
            throw new Error("LLM returned malformed decomposition structure.");
        }
    }

    decompositionResult.taskId = taskId;

    const subtaskIds = new Set();
    decompositionResult.subtasks.forEach((st, index) => {
        if (!st.subtaskId) {
            st.subtaskId = `subtask_${index + 1}`;
        }
        if (subtaskIds.has(st.subtaskId)) {
            console.warn(`Duplicate subtaskId found: ${st.subtaskId}. Appending index.`);
            st.subtaskId = `<span class="math-inline">\{st\.subtaskId\}\_</span>{index}`;
        }
        subtaskIds.add(st.subtaskId);
        st.dependencies = st.dependencies || [];
        st.parallelGroup = st.parallelGroup || `group_${index + 1}`;
        st.description = st.description || st.subtaskName;
    });

    await storeTaskEmbeddings(decompositionResult);

    return decompositionResult;
  } catch (error) {
    console.error("Error during task decomposition in taskDecomposer.js:", error);
    throw error;
  }
}

export function saveJsonToFile(jsonData, filePath) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(jsonData, null, 2), "utf-8");
    console.log(`JSON data saved successfully to ${filePath}`);
  } catch (error) {
    console.error("Error saving JSON to file:", error.message);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  (async () => {
    if (process.argv.length < 3) {
      console.log("Usage: node taskDecomposer.js 'Your task description'");
      process.exit(1);
    }
    const mainTask = process.argv[2];
    try {
      console.log(`Decomposing task: "${mainTask}"...`);
      const taskDecomposition = await decomposeTask(mainTask);
      // tasks.json is conventional
      const filePath = path.join(process.cwd(), "tasks.json");
      saveJsonToFile(taskDecomposition, filePath);
      console.log("Decomposition complete!");
      console.log(JSON.stringify(taskDecomposition, null, 2));
    } catch (error) {
      console.error("An error occurred during CLI execution:", error.message);
    }
  })();
}