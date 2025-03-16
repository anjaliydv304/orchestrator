import * as fs from 'node:fs';
import * as path from 'node:path';

export default function generateAgentsFromTasks(taskFilePath, agentFilePath) {
  try {
    const taskData = JSON.parse(fs.readFileSync(taskFilePath, 'utf-8'));
    
    if (!taskData.subtasks || !Array.isArray(taskData.subtasks)) {
      throw new Error("Invalid task format: 'subtasks' array missing.");
    }

    const agents = taskData.subtasks.map(subtask => ({
      agentId: subtask.subtaskId,
      agentName: `Agent for ${subtask.subtaskName}`,
      taskAssigned: subtask.subtaskName,
      dependencies: subtask.dependencies,
      parallelGroup: subtask.parallelGroup
    }));

    const agentData = {
      mainTask: taskData.mainTask,
      agents
    };

    fs.writeFileSync(agentFilePath, JSON.stringify(agentData, null, 2), 'utf-8');
    console.log(`Agents JSON saved successfully to ${agentFilePath}`);
    
    return agentData;
  } catch (error) {
    console.error("Error generating agents:", error.message);
    throw error;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const taskFilePath = path.join(process.cwd(), 'tasks.json');
  const agentFilePath = path.join(process.cwd(), 'agents.json');
  generateAgentsFromTasks(taskFilePath, agentFilePath);
}
