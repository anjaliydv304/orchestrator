import generateAgentsFromTasks from '../dynamicAgentCreator';
import * as fs from 'node:fs';
import * as path from 'node:path'; // path is not explicitly used in the function but often in the calling script

// Mock the 'fs' module
jest.mock('node:fs');

// Mock console.log and console.error
global.console = {
    ...console,
    log: jest.fn(),
    error: jest.fn(),
};

describe('dynamicAgentCreator', () => {
    const mockTaskFilePath = '/mock/tasks.json';
    const mockAgentFilePath = '/mock/agents.json';

    beforeEach(() => {
        // Reset mocks before each test
        fs.readFileSync.mockReset();
        fs.writeFileSync.mockReset();
        console.log.mockClear();
        console.error.mockClear();
    });

    const mockTaskData = {
        mainTask: 'Test Main Task',
        subtasks: [
            {
                subtaskId: 'sub1',
                subtaskName: 'First Subtask',
                dependencies: [],
                parallelGroup: 'A',
            },
            {
                subtaskId: 'sub2',
                subtaskName: 'Second Subtask',
                dependencies: ['sub1'],
                parallelGroup: 'B',
            },
        ],
    };

    it('should generate agent data from a valid task file and write to agent file', () => {
        fs.readFileSync.mockReturnValue(JSON.stringify(mockTaskData));

        const expectedAgentData = {
            mainTask: 'Test Main Task',
            agents: [
                {
                    agentId: 'sub1',
                    agentName: 'Agent for First Subtask',
                    taskAssigned: 'First Subtask',
                    dependencies: [],
                    parallelGroup: 'A',
                },
                {
                    agentId: 'sub2',
                    agentName: 'Agent for Second Subtask',
                    taskAssigned: 'Second Subtask',
                    dependencies: ['sub1'],
                    parallelGroup: 'B',
                },
            ],
        };

        const result = generateAgentsFromTasks(mockTaskFilePath, mockAgentFilePath);

        expect(fs.readFileSync).toHaveBeenCalledWith(mockTaskFilePath, 'utf-8');
        expect(result).toEqual(expectedAgentData);
        expect(fs.writeFileSync).toHaveBeenCalledWith(
            mockAgentFilePath,
            JSON.stringify(expectedAgentData, null, 2),
            'utf-8'
        );
        expect(console.log).toHaveBeenCalledWith(`Agents JSON saved successfully to ${mockAgentFilePath}`);
    });

    it('should throw an error if taskData.subtasks is missing', () => {
        const invalidTaskData = { mainTask: 'Another Task' }; // No subtasks array
        fs.readFileSync.mockReturnValue(JSON.stringify(invalidTaskData));

        expect(() => {
            generateAgentsFromTasks(mockTaskFilePath, mockAgentFilePath);
        }).toThrow("Invalid task format: 'subtasks' array missing.");
        expect(console.error).toHaveBeenCalledWith("Error generating agents:", "Invalid task format: 'subtasks' array missing.");
        expect(fs.writeFileSync).not.toHaveBeenCalled();
    });

    it('should throw an error if taskData.subtasks is not an array', () => {
        const invalidTaskData = { mainTask: 'Task C', subtasks: 'not-an-array' };
        fs.readFileSync.mockReturnValue(JSON.stringify(invalidTaskData));

        expect(() => {
            generateAgentsFromTasks(mockTaskFilePath, mockAgentFilePath);
        }).toThrow("Invalid task format: 'subtasks' array missing."); // The check is !Array.isArray
         expect(console.error).toHaveBeenCalledWith("Error generating agents:", "Invalid task format: 'subtasks' array missing.");
        expect(fs.writeFileSync).not.toHaveBeenCalled();
    });


    it('should handle subtasks with missing optional fields gracefully (dependencies, parallelGroup)', () => {
        const taskDataWithMissingFields = {
            mainTask: 'Task With Missing Fields',
            subtasks: [
                { subtaskId: 's1', subtaskName: 'Subtask One' }, // Missing dependencies and parallelGroup
            ],
        };
        fs.readFileSync.mockReturnValue(JSON.stringify(taskDataWithMissingFields));

        const expectedAgentData = {
            mainTask: 'Task With Missing Fields',
            agents: [
                {
                    agentId: 's1',
                    agentName: 'Agent for Subtask One',
                    taskAssigned: 'Subtask One',
                    dependencies: undefined, // or how your code handles it (currently keeps as undefined)
                    parallelGroup: undefined,
                },
            ],
        };

        const result = generateAgentsFromTasks(mockTaskFilePath, mockAgentFilePath);
        expect(result).toEqual(expectedAgentData);
        expect(fs.writeFileSync).toHaveBeenCalled();
    });


    it('should re-throw error if fs.readFileSync fails', () => {
        fs.readFileSync.mockImplementation(() => {
            throw new Error('File read error');
        });

        expect(() => {
            generateAgentsFromTasks(mockTaskFilePath, mockAgentFilePath);
        }).toThrow('File read error');
        expect(console.error).toHaveBeenCalledWith("Error generating agents:", "File read error");
    });

    it('should re-throw error if fs.writeFileSync fails', () => {
        fs.readFileSync.mockReturnValue(JSON.stringify(mockTaskData));
        fs.writeFileSync.mockImplementation(() => {
            throw new Error('File write error');
        });

        expect(() => {
            generateAgentsFromTasks(mockTaskFilePath, mockAgentFilePath);
        }).toThrow('File write error');
        // console.error in this case is called from the catch block after writeFileSync
        expect(console.error).toHaveBeenCalledWith("Error generating agents:", "File write error");

    });
});