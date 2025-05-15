import { ModelContextProtocol } from '../mcp';

// Mock the console.warn and console.error
global.console = {
  ...console,
  warn: jest.fn(),
  error: jest.fn(),
};

describe('ModelContextProtocol', () => {
  let mockModel;
  let mcp;

  beforeEach(() => {
    mockModel = {
      generateContent: jest.fn(),
    };
    console.warn.mockClear();
    console.error.mockClear();
  });

  describe('Constructor', () => {
    it('should initialize with default values', () => {
      mcp = new ModelContextProtocol(mockModel);
      expect(mcp.model).toBe(mockModel);
      expect(mcp.agentConfig).toEqual({});
      expect(mcp.contextWindow).toEqual([]);
      expect(mcp.maxContextTokens).toBe(8000);
      expect(mcp.toolsForSDK).toBeUndefined();
    });

    it('should initialize with agentConfig and system instruction', () => {
      const agentConfig = {
        systemInstruction: 'You are a helpful assistant.',
        maxContextTokens: 4000,
        tools: [{ functionDeclarations: [{ name: 'testTool' }] }],
      };
      mcp = new ModelContextProtocol(mockModel, agentConfig);
      expect(mcp.contextWindow).toEqual([
        { role: 'system', content: 'You are a helpful assistant.' },
      ]);
      expect(mcp.maxContextTokens).toBe(4000);
      expect(mcp.toolsForSDK).toEqual([{ functionDeclarations: [{ name: 'testTool' }] }]);
    });
  });

  describe('addToContext', () => {
    beforeEach(() => {
      mcp = new ModelContextProtocol(mockModel);
    });

    it('should add a system message to the beginning of the context window', () => {
      mcp.addToContext('system', 'System message 1', true);
      mcp.addToContext('user', 'User message 1');
      mcp.addToContext('system', 'System message 2', true); // Should warn and still add
      expect(mcp.contextWindow[0]).toEqual({ role: 'system', content: 'System message 2' });
      expect(mcp.contextWindow[1]).toEqual({ role: 'system', content: 'System message 1' });
      expect(console.warn).toHaveBeenCalledTimes(1); // For the second system message
    });

    it('should add non-system messages to the end', () => {
      mcp.addToContext('user', 'Hello');
      mcp.addToContext('assistant', 'Hi there');
      expect(mcp.contextWindow).toEqual([
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there' },
      ]);
    });

    it('should call manageContextWindow after adding a message', () => {
      const manageSpy = jest.spyOn(mcp, 'manageContextWindow');
      mcp.addToContext('user', 'Test');
      expect(manageSpy).toHaveBeenCalled();
      manageSpy.mockRestore();
    });
  });

  describe('manageContextWindow', () => {
    // This is a simplified test; accurate token counting is complex
    it('should remove older non-system messages if estimated token count exceeds maxContextTokens', () => {
      mcp = new ModelContextProtocol(mockModel, { maxContextTokens: 10 }); // Small limit for testing
      mcp.addToContext('system', 'S', true); // System instruction
      mcp.addToContext('user', 'This is a user message that is quite long.'); // Approx 11 tokens
      mcp.addToContext('assistant', 'This is an assistant response also long.'); // Approx 10 tokens
      // Expected: 'S' and the last message should remain.
      // console.log(mcp.contextWindow); // For debugging
      expect(mcp.contextWindow.length).toBeLessThanOrEqual(2); // System + one more at most
      expect(mcp.contextWindow.find(m => m.role === 'system')).toBeTruthy();
      // Depending on exact estimation, the 'user' message might be removed.
    });

     it('should remove older non-system messages if message history exceeds MAX_MESSAGES_HISTORY (30)', () => {
        mcp = new ModelContextProtocol(mockModel); // Default maxContextTokens is large
        mcp.addToContext('system', 'S', true);
        for (let i = 0; i < 35; i++) {
            mcp.addToContext('user', `User message ${i}`);
        }
        // console.log(mcp.contextWindow.length);
        expect(mcp.contextWindow.length).toBe(30 + 1); // 30 user messages + 1 system
        expect(mcp.contextWindow[0].content).toBe('S');
        expect(mcp.contextWindow[1].content).toBe('User message 5'); // The 6th user message added (index 5)
    });
  });


  describe('formatContextForModelSDK', () => {
    beforeEach(() => {
      mcp = new ModelContextProtocol(mockModel);
    });

    it('should format user and assistant roles correctly', () => {
      mcp.addToContext('user', 'Hello');
      mcp.addToContext('assistant', 'World');
      const formatted = mcp.formatContextForModelSDK();
      expect(formatted).toEqual([
        { role: 'user', parts: [{ text: 'Hello' }] },
        { role: 'model', parts: [{ text: 'World' }] },
      ]);
    });

    it('should format system messages as model role for SDK', () => {
      mcp.addToContext('system', 'System prompt', true);
      const formatted = mcp.formatContextForModelSDK();
      expect(formatted).toEqual([
        { role: 'model', parts: [{ text: 'System prompt' }] },
      ]);
    });

    it('should format tool calls from assistant', () => {
      const toolCallData = [{ name: 'searchTool', args: { query: 'test' } }];
      mcp.addToContext('assistant', `Tool Call: ${JSON.stringify(toolCallData)}`);
      const formatted = mcp.formatContextForModelSDK();
      expect(formatted).toEqual([
        { role: 'model', parts: [{ functionCall: { name: 'searchTool', args: { query: 'test' } } }] },
      ]);
    });

    it('should format tool responses (as user role for SDK after functionResponse)', () => {
      const toolResponses = [{ name: 'searchTool', response: { data: 'results' } }];
      mcp.addToContext('tool', JSON.stringify(toolResponses)); // tool content is stringified array of functionResponse
      const formatted = mcp.formatContextForModelSDK();
      expect(formatted).toEqual([
        { role: 'user', parts: [{ functionResponse: { name: 'searchTool', response: { data: 'results' } } }] },
      ]);
    });

    it('should handle malformed tool call string from assistant gracefully', () => {
        mcp.addToContext('assistant', `Tool Call: this is not json`);
        const formatted = mcp.formatContextForModelSDK();
        expect(formatted).toEqual([
            { role: 'model', parts: [{ text: 'Tool Call: this is not json' }] },
        ]);
        expect(console.warn).toHaveBeenCalled();
    });

    it('should handle malformed tool response string gracefully', () => {
        mcp.addToContext('tool', `this is not a json array of functionResponses`);
        const formatted = mcp.formatContextForModelSDK();
        expect(formatted).toEqual([
            { role: 'user', parts: [{ text: 'Error processing tool response: this is not a json array of functionResponses' }] },
        ]);
        expect(console.error).toHaveBeenCalled();
    });
  });

  describe('generateResponse', () => {
    const agentConfig = {
      modelSettings: { temperature: 0.5 },
      maxOutputTokens: 100,
    };

    beforeEach(() => {
      mcp = new ModelContextProtocol(mockModel, agentConfig);
    });

    it('should generate a text response', async () => {
      mockModel.generateContent.mockResolvedValue({
        response: {
          candidates: [{ content: { parts: [{ text: 'LLM Response' }] } }],
        },
      });
      const response = await mcp.generateResponse('User Query');
      expect(response).toBe('LLM Response');
      expect(mcp.contextWindow).toContainEqual({ role: 'user', content: 'User Query' });
      expect(mcp.contextWindow).toContainEqual({ role: 'assistant', content: 'LLM Response' });
      expect(mockModel.generateContent).toHaveBeenCalledWith(expect.objectContaining({
        contents: expect.any(Array),
        generationConfig: { temperature: 0.5, maxOutputTokens: 100 },
      }));
    });

    it('should generate tool calls', async () => {
      const functionCall = { name: 'myTool', args: { param1: 'value1' } };
      mockModel.generateContent.mockResolvedValue({
        response: {
          candidates: [{ content: { parts: [{ functionCall }] } }],
        },
      });
      const response = await mcp.generateResponse('Call a tool');
      expect(response).toEqual({ toolCalls: [functionCall] });
      expect(mcp.contextWindow).toContainEqual({ role: 'assistant', content: `Tool Call: ${JSON.stringify([functionCall])}` });
    });

    it('should handle LLM API errors', async () => {
      const apiError = new Error('API Error');
      apiError.status = 500;
      mockModel.generateContent.mockRejectedValue(apiError);
      await expect(mcp.generateResponse('Query')).rejects.toEqual(expect.objectContaining({
        message: 'LLM generation failed in MCP',
        details: 'API Error',
        status: 500,
      }));
      expect(mcp.contextWindow).toContainEqual({ role: 'system', content: 'Error during generation: API Error' });
      expect(console.error).toHaveBeenCalled();
    });

    it('should parse JSON response if present', async () => {
        const jsonResponse = { key: 'value', nested: { number: 123 } };
        mockModel.generateContent.mockResolvedValue({
            response: {
                candidates: [{ content: { parts: [{ text: JSON.stringify(jsonResponse) }] } }],
            },
        });
        const response = await mcp.generateResponse('User Query expecting JSON');
        expect(response).toEqual(jsonResponse);
    });

    it('should parse JSON response with markdown backticks', async () => {
        const jsonResponse = { key: 'value' };
        mockModel.generateContent.mockResolvedValue({
            response: {
                candidates: [{ content: { parts: [{ text: "```json\n" + JSON.stringify(jsonResponse) + "\n```" }] } }],
            },
        });
        const response = await mcp.generateResponse('User Query expecting JSON in markdown');
        expect(response).toEqual(jsonResponse);
    });

    it('should use provided tools in SDK call', async () => {
        const tools = [{ functionDeclarations: [{ name: 'toolA' }] }];
        mcp = new ModelContextProtocol(mockModel, { tools });
        mockModel.generateContent.mockResolvedValue({
            response: { candidates: [{ content: { parts: [{ text: 'OK' }] } }] },
        });
        await mcp.generateResponse('Test');
        expect(mockModel.generateContent).toHaveBeenCalledWith(expect.objectContaining({
            tools: tools
        }));
    });
  });

  describe('parseResponse', () => {
    beforeEach(() => {
      mcp = new ModelContextProtocol(mockModel);
    });

    it('should parse a valid JSON string', () => {
      const jsonString = '{"name":"Test","value":123}';
      expect(mcp.parseResponse(jsonString)).toEqual({ name: 'Test', value: 123 });
    });

    it('should parse a valid JSON string with markdown backticks', () => {
      const jsonString = '```json\n{"name":"Test","value":123}\n```';
      expect(mcp.parseResponse(jsonString)).toEqual({ name: 'Test', value: 123 });
    });

    it('should return the original string if not valid JSON', () => {
      const plainString = 'This is not JSON.';
      expect(mcp.parseResponse(plainString)).toBe(plainString);
    });

    it('should return the original string for malformed JSON', () => {
      const malformedJson = '{"name":"Test",';
      expect(mcp.parseResponse(malformedJson)).toBe(malformedJson);
    });
  });
});