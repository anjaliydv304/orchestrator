import { GoogleGenerativeAI } from "@google/generative-ai";
import * as fs from 'node:fs';
import dotenv from "dotenv";
import * as path from 'node:path';
dotenv.config();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const model = genAI.getGenerativeModel({
  model: "gemini-1.5-flash",
  systemInstruction: `You are a task decomposition assistant. 
    Decompose the given main task into a structured list of subtasks in valid JSON format.
    
    Each subtask must include:
    - "subtaskId": A unique numerical identifier.
    - "subtaskName": A clear description of the subtask.
    - "dependencies": A list of subtask IDs that must be completed first (empty if no dependencies).
    - "parallelGroup": A group number indicating which tasks can be done in parallel.

    Ensure the response is raw JSON, with no extra text, explanations, or formatting.

    Example output:
    {
      "mainTask": "Task description",
      "subtasks": [
        {
          "subtaskId": 1,
          "subtaskName": "Research the topic",
          "dependencies": [],
          "parallelGroup": 1
        },
        {
          "subtaskId": 2,
          "subtaskName": "Outline the article",
          "dependencies": [1],
          "parallelGroup": 2
        }
      ]
    }`
});


function cleanJsonResponse(responseText) {
  try {
    const cleanText = responseText.replace(/```json|```/g, "").trim();
    return JSON.parse(cleanText);
  } catch (error) {
    console.error("Error parsing AI response:", error.message);
    throw new Error("Received invalid JSON from AI.");
  }
}


async function decomposeTask(mainTask) {
  const prompt = `Decompose the task: ${mainTask}`;

  try {
    const result = await model.generateContent(prompt);
    const rawResponse = result.response.text();
    return cleanJsonResponse(rawResponse);
  } catch (error) {
    console.error("Error during task decomposition:", error.message);
    throw new Error("Failed to decompose the task.");
  }
}

function saveJsonToFile(jsonData, filePath) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(jsonData, null, 2), "utf-8");
    console.log(`Task JSON saved successfully to ${filePath}`);
  } catch (error) {
    console.error("Error saving JSON to file:", error.message);
  }
}

// Main 
(async () => {
  const mainTask = "Write an article on benefits of meditation";

  try {
    const taskDecomposition = await decomposeTask(mainTask);
    const filePath = path.join(process.cwd(), 'tasks.json');

    saveJsonToFile(taskDecomposition, filePath);
  } catch (error) {
    console.error("An error occurred:", error.message);
  }
})();
