import { jest } from '@jest/globals';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

jest.unstable_mockModule('node:fs', () => ({
  readFileSync: jest.fn(),
  writeFileSync: jest.fn(),
  existsSync: jest.fn().mockReturnValue(true),
}));

describe('Dynamic Agent Creator Unit Tests', () => {
  let fs;
  let generateAgentsFromTasks;
  
  beforeEach(async () => {
    jest.resetModules();
    
    fs = await import('node:fs');
  
    const dynamicAgentCreator = await import('../src/dynamicAgentCreator.js');
    generateAgentsFromTasks = dynamicAgentCreator.default;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should generate agents from tasks and save to file', async () => {
    const taskFilePath = path.join(__dirname, 'test-tasks.json');
    const agentFilePath = path.join(__dirname, 'test-agents.json');
    
    const tasks = {
      mainTask: 'Test Main Task',
      subtasks: [
        {
          subtaskId: 1,
          subtaskName: 'Subtask 1',
          dependencies: [],
          parallelGroup: 1,
        },
      ],
    };
  
    fs.readFileSync.mockReturnValue(JSON.stringify(tasks));
    
    await generateAgentsFromTasks(taskFilePath, agentFilePath);
  
    expect(fs.writeFileSync).toHaveBeenCalledWith(
      agentFilePath,
      expect.any(String),
      'utf-8'
    );
    
    const writtenContent = fs.writeFileSync.mock.calls[0][1];
    const writtenData = JSON.parse(writtenContent);
    
    expect(writtenData).toEqual({
      mainTask: 'Test Main Task',
      agents: [
        {
          agentId: 1,
          agentName: 'Agent for Subtask 1',
          taskAssigned: 'Subtask 1',
          dependencies: [],
          parallelGroup: 1,
        },
      ],
    });
  });

  it('should throw error if subtasks are missing', async () => {
    const taskFilePath = path.join(__dirname, 'test-tasks.json');
    const agentFilePath = path.join(__dirname, 'test-agents.json');
    
    const tasks = { mainTask: 'Test Main Task' };
    fs.readFileSync.mockReturnValue(JSON.stringify(tasks));

    await expect(async () => {
      await generateAgentsFromTasks(taskFilePath, agentFilePath);
    }).rejects.toThrow("Invalid task format: 'subtasks' array missing.");
  });
  
  it('should handle tasks with multiple subtasks', async () => {
    const taskFilePath = path.join(__dirname, 'test-tasks.json');
    const agentFilePath = path.join(__dirname, 'test-agents.json');
    
    const tasks = {
      mainTask: 'Complex Task',
      subtasks: [
        {
          subtaskId: 1,
          subtaskName: 'Research',
          dependencies: [],
          parallelGroup: 1,
        },
        {
          subtaskId: 2,
          subtaskName: 'Development',
          dependencies: [1],
          parallelGroup: 2,
        },
        {
          subtaskId: 3,
          subtaskName: 'Testing',
          dependencies: [2],
          parallelGroup: 3,
        }
      ],
    };

    fs.readFileSync.mockReturnValue(JSON.stringify(tasks));
    
    await generateAgentsFromTasks(taskFilePath, agentFilePath);
    
    const writtenContent = fs.writeFileSync.mock.calls[0][1];
    const writtenData = JSON.parse(writtenContent);
    
    expect(writtenData.agents.length).toBe(3);
    expect(writtenData.agents[1].dependencies).toEqual([1]);
    expect(writtenData.agents[2].taskAssigned).toBe('Testing');
  });
});