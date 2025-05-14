export class ModelContextProtocol {
  constructor(model, agentConfig = {}) {
    this.model = model;
    this.agentConfig = agentConfig;
    this.contextWindow = [];
    this.maxContextTokens = agentConfig.maxContextTokens || 8000;
    this.toolsForSDK = this.agentConfig.tools;

    if (this.agentConfig.systemInstruction) {
      this.addToContext("system", this.agentConfig.systemInstruction, true);
    }
  }

  addToContext(role, content, isSystemInstruction = false) {
    if (isSystemInstruction) {
        const existingSystemInstruction = this.contextWindow.find(m => m.role === 'system');
        if (existingSystemInstruction) {
            console.warn("MCP: Adding system instruction to context, ensure it's not duplicating model's inherent system instruction.");
        }
        this.contextWindow.unshift({ role, content: String(content) });
    } else {
        this.contextWindow.push({ role, content: String(content) });
    }
    this.manageContextWindow();
  }

  manageContextWindow() {
    // For accurate token counting, a tokenizer library for the specific model should be used.
    let estimatedTokenCount = this.contextWindow.reduce((acc, msg) => {
        const textContent = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
        return acc + Math.ceil(textContent.length / 4);
    }, 0);

    const MAX_MESSAGES_HISTORY = 30;

    while (
        (estimatedTokenCount > this.maxContextTokens || this.contextWindow.length > MAX_MESSAGES_HISTORY) &&
        this.contextWindow.length > 1
    ) {
        const firstNonSystemIndex = this.contextWindow.findIndex(m => m.role !== 'system');

        if (firstNonSystemIndex !== -1 && this.contextWindow.length > 1) {
            const removedMessage = this.contextWindow.splice(firstNonSystemIndex, 1)[0];
            const removedContent = typeof removedMessage.content === 'string' ? removedMessage.content : JSON.stringify(removedMessage.content);
            estimatedTokenCount -= Math.ceil(removedContent.length / 4);
        } else {
            break;
        }
    }
  }

  /**
   * Formats the internal context window into the structure expected by the Google Generative AI SDK.
   * Gemini API expects: [{role: 'user'/'model', parts: [{text: ''} or {functionCall: ...} or {functionResponse: ...}]}]
   * System instructions are typically handled at model initialization (getGenerativeModel({ systemInstruction: ... }))
   * or can be the first 'model' role message if the SDK/API version requires it explicitly in contents.
   */
  formatContextForModelSDK() {
    return this.contextWindow.map(message => {
      let sdkRole = 'user';
      if (message.role === 'assistant' || message.role === 'system') {
        sdkRole = 'model';
      } else if (message.role === 'user') {
        sdkRole = 'user';
      }
      if (message.role === 'tool') {
        try {
          const functionResponsesArray = JSON.parse(message.content);
          const functionResponseParts = functionResponsesArray.map(funcResp => ({
            functionResponse: funcResp
          }));
          return { role: 'user', parts: functionResponseParts };
        } catch (e) {
          console.error("MCP: Could not parse/format tool content for SDK. Content:", message.content, e);
          return { role: 'user', parts: [{ text: `Error processing tool response: ${message.content}` }]};
        }
      }

      if (message.role === 'assistant' && typeof message.content === 'string' && message.content.startsWith("Tool Call:")) {
          try {
              const callData = JSON.parse(message.content.substring("Tool Call:".length).trim());
              return { role: 'model', parts: callData.map(fc => ({ functionCall: fc })) };
          } catch (e) {
              console.warn("MCP: Could not parse assistant's tool call string for SDK. Treating as text.", e);
              return { role: 'model', parts: [{ text: message.content }] };
          }
      }

      return { role: sdkRole, parts: [{ text: String(message.content) }] };
    }).filter(msg => msg.parts && msg.parts.length > 0);
  }

  /**
   * @param {string | Array<object>} promptOrParts - Can be a string (for user's initial prompt)
   * or an array of FunctionResponsePart (when providing tool execution results)
   * @param {boolean} isToolResponseContext
   */
  async generateResponse(promptOrParts, isToolResponseContext = false) {
    if (!isToolResponseContext && typeof promptOrParts === 'string') {
        this.addToContext("user", promptOrParts);
    }

    const modelCompatibleHistory = this.formatContextForModelSDK();

    try {
      const generationConfig = this.agentConfig.modelSettings || {
        temperature: 0.7,
        maxOutputTokens: this.agentConfig.maxOutputTokens || 2048,
      };

      const requestPayload = {
          contents: modelCompatibleHistory,
          generationConfig,
          tools: this.toolsForSDK,
      };

      const result = await this.model.generateContent(requestPayload);
      const response = result.response;

      let responseText = "";
      let functionCalls = [];

      if (response.candidates && response.candidates.length > 0) {
          const candidate = response.candidates[0];
          if (candidate.content && candidate.content.parts) {
              for (const part of candidate.content.parts) {
                  if (part.text) {
                      responseText += part.text;
                  }
                  if (part.functionCall) {
                      const fc = part.functionCall;
                      functionCalls.push({ name: fc.name, args: fc.args || {} });
                  }
              }
          }
      }

      if (functionCalls.length > 0) {
        this.addToContext("assistant", `Tool Call: ${JSON.stringify(functionCalls)}`);
        return { toolCalls: functionCalls };
      } else {
        this.addToContext("assistant", responseText);
        return this.parseResponse(responseText);
      }

    } catch (error) {
      console.error("MCP: Error generating response from LLM:", error.status, error.message, error.errorDetails || error);
      this.addToContext("system", `Error during generation: ${error.message}`);
      throw {
          message: "LLM generation failed in MCP",
          details: error.message,
          status: error.status,
          originalError: error
      };
    }
  }

  parseResponse(responseString) {
    try {
      const jsonMatch = responseString.match(/```json\s*([\s\S]*?)\s*```/);
      if (jsonMatch && jsonMatch[1]) {
        return JSON.parse(jsonMatch[1]);
      }
      return JSON.parse(responseString);
    } catch (error) {
      return responseString;
    }
  }
}