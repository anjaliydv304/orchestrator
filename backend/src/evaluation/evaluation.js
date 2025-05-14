import { GoogleGenerativeAI } from "@google/generative-ai";
import dotenv from "dotenv";
import { storeKnowledgeItem } from "../services/vectorDb.js";

dotenv.config();

let evaluationGenAI;
let evaluationLLM;

function getEvaluationModel() {
    if (!evaluationLLM) {
        if (!process.env.GEMINI_API_KEY) {
            throw new Error("GEMINI_API_KEY is not set in environment variables.");
        }
        evaluationGenAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        evaluationLLM = evaluationGenAI.getGenerativeModel({
            model: "gemini-1.5-flash-latest", // Or a more powerful model for evaluation
        });
    }
    return evaluationLLM;
}

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function getJsonFromLlmResponse(prompt) {
    const model = getEvaluationModel();
    let rawResponseText = "N/A";
    const maxRetries = 5;
    let initialBackoffMs = 1000;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            const fullPrompt = prompt + "\n\nRespond ONLY with a valid JSON object. Do not include any explanatory text before or after the JSON block. The JSON should be directly parsable.";
            const generationResult = await model.generateContent(fullPrompt);

            if (generationResult && generationResult.response && typeof generationResult.response.text === 'function') {
                rawResponseText = generationResult.response.text();
            } else {
                console.error("Invalid response structure from LLM:", generationResult);
                throw new Error("Invalid response structure from LLM or text method missing.");
            }

            const match = rawResponseText.match(/```json\s*([\s\S]*?)\s*```/);
            if (match && match[1]) {
                return JSON.parse(match[1]);
            }
            return JSON.parse(rawResponseText);

        } catch (error) {
            rawResponseText = error.message;

            if (error.status === 429 && attempt < maxRetries - 1) {
                let retryAfterMs = initialBackoffMs * Math.pow(2, attempt);

                if (error.originalError && error.originalError.errorDetails) {
                    const retryInfo = error.originalError.errorDetails.find(detail => detail['@type'] === 'type.googleapis.com/google.rpc.RetryInfo');
                    if (retryInfo && retryInfo.retryDelay) {
                        const delaySeconds = parseInt(retryInfo.retryDelay.replace('s', ''), 10);
                        if (!isNaN(delaySeconds)) {
                            retryAfterMs = delaySeconds * 1000;
                            console.warn(`Evaluation LLM: Rate limit hit (attempt <span class="math-inline">\{attempt \+ 1\}/</span>{maxRetries}). Retrying after ${delaySeconds}s (from API suggestion).`);
                        } else {
                             console.warn(`Evaluation LLM: Rate limit hit (attempt <span class="math-inline">\{attempt \+ 1\}/</span>{maxRetries}). Could not parse retryDelay '${retryInfo.retryDelay}'. Retrying after ${retryAfterMs / 1000}s (calculated backoff).`);
                        }
                    } else {
                         console.warn(`Evaluation LLM: Rate limit hit (attempt <span class="math-inline">\{attempt \+ 1\}/</span>{maxRetries}). Retrying after ${retryAfterMs / 1000}s (calculated backoff).`);
                    }
                } else if (error.status === 429) {
                     console.warn(`Evaluation LLM: Rate limit hit (attempt <span class="math-inline">\{attempt \+ 1\}/</span>{maxRetries}). Error details for specific retryDelay not found. Retrying after ${retryAfterMs / 1000}s (calculated backoff).`);
                }

                await delay(retryAfterMs);
                continue;
            } else {
                console.error(`Evaluation LLM Error (attempt <span class="math-inline">\{attempt \+ 1\}/</span>{maxRetries}): Failed to get/parse JSON. Prompt: "${prompt.substring(0, 200)}..."`, error.message, error.status ? `Status: ${error.status}`: '');
                if (rawResponseText !== "N/A" && !rawResponseText.startsWith("LLM generation failed") && !rawResponseText.includes("text method missing")) {
                    console.error("LLM Raw Response/Error (that failed parsing or final error):", rawResponseText);
                }
                return {
                    error: "LLM_JSON_PARSING_OR_API_ERROR",
                    rating: 0,
                    reason: `Error during LLM evaluation or JSON parsing after ${attempt + 1} attempts: ${error.message}. Raw response/error: ${String(rawResponseText).substring(0, 200)}...`,
                    status: error.status
                };
            }
        }
    }
    return {
        error: "LLM_MAX_RETRIES_REACHED",
        rating: 0,
        reason: `Max retries (${maxRetries}) reached for LLM evaluation. Last error: ${String(rawResponseText).substring(0,200)}...`
    };
}

export class AgentEvaluator {
  constructor() {
    this.metricsStore = {
      accuracy: [],
      efficiency: [],
      completeness: [],
      coherence: [],
    };
  }

  async evaluateAgent(agentReport, originalTaskContext) {
    const { agentId, agentName, agentType, taskAssigned, result, reasoning, executionTimeMs, status } = agentReport;
    const { description: mainTaskDescription, subtask: originalSubtaskDefinition } = originalTaskContext || {};

    if (status === 'error' || (result && result.error)) {
        const errorMessage = result && result.error ? JSON.stringify(result.error) : (result && result.details ? result.details : 'Unknown error during execution');
        const errorEvaluation = {
            agentId,
            taskAssigned,
            status: 'error',
            accuracy: { rating: 1, reason: `Agent execution failed: ${errorMessage}` },
            completeness: { rating: 1, reason: "Task not completed due to error." },
            coherence: { rating: 1, reason: "No coherent output due to error." },
            efficiency: { rating: 1, reason: `Execution failed or produced error. Time: ${executionTimeMs || 'N/A'}ms.` },
            overall: 1,
            feedback: `Agent encountered an error: ${errorMessage}. Review logs for details.`,
            timestamp: new Date().toISOString()
        };
        Object.keys(this.metricsStore).forEach(metricKey => {
            if (errorEvaluation[metricKey] && this.metricsStore[metricKey]) {
                this.metricsStore[metricKey].push({ agentId, task: taskAssigned, ...errorEvaluation[metricKey] });
            }
        });
        return errorEvaluation;
    }

    const consolidatedMetricsPrompt = `
      Main Task: ${mainTaskDescription || 'N/A'}
      Assigned Subtask: ${taskAssigned} (Original definition: ${originalSubtaskDefinition?.description || 'N/A'})
      Agent Type: ${agentType}
      Agent Result: ${JSON.stringify(result)}
      Agent Reasoning: ${JSON.stringify(reasoning)}

      Evaluate the agent's performance on the following metrics, each on a scale of 1-10 (1=Very Poor, 10=Excellent):
      1. ACCURACY: Is the result factually correct, relevant, and directly addresses the subtask?
      2. COMPLETENESS: Does the result address all aspects of the subtask comprehensively?
      3. COHERENCE: Is the reasoning sound, easy to follow, and logically leads to the result?

      Provide your ratings and brief reasons for each as a single JSON object.
      Example:
      {
        "accuracy": { "rating": number, "reason": "explanation" },
        "completeness": { "rating": number, "reason": "explanation" },
        "coherence": { "rating": number, "reason": "explanation" }
      }`;

    const metricsEval = await getJsonFromLlmResponse(consolidatedMetricsPrompt);

    if (metricsEval.error) {
        const llmErrorEvaluation = {
            agentId, taskAssigned, status: 'evaluation_llm_error',
            accuracy: { rating: 1, reason: `LLM evaluation error: ${metricsEval.reason}` },
            completeness: { rating: 1, reason: `LLM evaluation error: ${metricsEval.reason}` },
            coherence: { rating: 1, reason: `LLM evaluation error: ${metricsEval.reason}` },
            efficiency: { rating: 1, reason: `Efficiency not assessed due to LLM error. Time: ${executionTimeMs || 'N/A'}ms.`},
            overall: 1,
            feedback: `Failed to get detailed metrics from LLM: ${metricsEval.reason}`,
            timestamp: new Date().toISOString()
        };
         Object.keys(this.metricsStore).forEach(metricKey => {
            if (llmErrorEvaluation[metricKey] && this.metricsStore[metricKey]) {
                this.metricsStore[metricKey].push({ agentId, task: taskAssigned, ...llmErrorEvaluation[metricKey] });
            }
        });
        return llmErrorEvaluation;
    }

    const accuracyEval = metricsEval.accuracy || { rating: 3, reason: "Accuracy data missing or invalid from LLM response." };
    const completenessEval = metricsEval.completeness || { rating: 3, reason: "Completeness data missing or invalid from LLM response." };
    const coherenceEval = metricsEval.coherence || { rating: 3, reason: "Coherence data missing or invalid from LLM response." };

    this.metricsStore.accuracy.push({ agentId, task: taskAssigned, ...accuracyEval });
    this.metricsStore.completeness.push({ agentId, task: taskAssigned, ...completenessEval });
    this.metricsStore.coherence.push({ agentId, task: taskAssigned, ...coherenceEval });

    let efficiencyEval = { rating: 5, reason: "Efficiency not deeply assessed by LLM." };
     if (typeof executionTimeMs === 'number') {
        if (executionTimeMs < 1000) efficiencyEval = { rating: 9, reason: `Very fast execution: ${executionTimeMs}ms`};
        else if (executionTimeMs < 5000) efficiencyEval = { rating: 7, reason: `Good execution time: ${executionTimeMs}ms`};
        else efficiencyEval = { rating: 4, reason: `Slow execution: ${executionTimeMs}ms`};
    }
    this.metricsStore.efficiency.push({ agentId, task: taskAssigned, rating: efficiencyEval.rating, reason: efficiencyEval.reason, executionTimeMs });

    const ratings = [accuracyEval.rating, completenessEval.rating, coherenceEval.rating, efficiencyEval.rating];
    const validRatings = ratings.filter(r => typeof r === 'number' && !isNaN(r));
    const overallScore = validRatings.length > 0 ? validRatings.reduce((sum, r) => sum + r, 0) / validRatings.length : 0;

    const feedbackPrompt = `
      Agent: <span class="math-inline">\{agentName\} \(</span>{agentType})
      Subtask: ${taskAssigned}
      Result: ${JSON.stringify(result)}
      Reasoning: ${JSON.stringify(reasoning)}
      Evaluation Scores:
      - Accuracy: <span class="math-inline">\{accuracyEval\.rating\}/10 \(</span>{accuracyEval.reason})
      - Completeness: <span class="math-inline">\{completenessEval\.rating\}/10 \(</span>{completenessEval.reason})
      - Coherence: <span class="math-inline">\{coherenceEval\.rating\}/10 \(</span>{coherenceEval.reason})
      - Efficiency: <span class="math-inline">\{efficiencyEval\.rating\}/10 \(</span>{efficiencyEval.reason})
      Overall Score: ${overallScore.toFixed(1)}/10

      Provide brief, constructive feedback (1-2 strengths, 1-2 improvement areas). Output only the feedback text.`;

    let feedbackText = "Feedback generation skipped or failed.";
    try {
        const model = getEvaluationModel();
        const feedbackGenerationResult = await model.generateContent(feedbackPrompt);
        if (feedbackGenerationResult && feedbackGenerationResult.response && typeof feedbackGenerationResult.response.text === 'function') {
            feedbackText = feedbackGenerationResult.response.text();
        } else {
             console.warn(`[Agent ${agentId}] Feedback generation returned invalid structure.`);
        }
    } catch (feedbackError) {
        console.error(`[Agent ${agentId}] Error during feedback generation: `, feedbackError.message, feedbackError.status);
        feedbackText = `Feedback generation failed: ${feedbackError.message} (Status: ${feedbackError.status || 'N/A'})`;
    }

    const finalEvaluation = {
        agentId,
        taskAssigned,
        status: 'evaluated',
        accuracy: accuracyEval,
        completeness: completenessEval,
        coherence: coherenceEval,
        efficiency: efficiencyEval,
        overall: parseFloat(overallScore.toFixed(1)),
        feedback: feedbackText,
        timestamp: new Date().toISOString()
    };
    // Example: await storeKnowledgeItem(`agent_eval_${agentId}_${new Date().getTime()}`, finalEvaluation, {type: 'agent_evaluation', agentId});

    return finalEvaluation;
  }

  getSummaryStatistics() {
    const summary = {};
    for (const metricName in this.metricsStore) {
      const metricData = this.metricsStore[metricName];
      if (metricData && metricData.length > 0) {
        const ratings = metricData.map(item => item.rating).filter(r => typeof r === 'number' && !isNaN(r));
        summary[metricName] = {
          count: ratings.length,
          average: ratings.length ? parseFloat((ratings.reduce((s, r) => s + r, 0) / ratings.length).toFixed(1)) : 0,
          min: ratings.length ? Math.min(...ratings) : 0,
          max: ratings.length ? Math.max(...ratings) : 0,
        };
      } else {
        summary[metricName] = { count: 0, average: 0, min: 0, max: 0 };
      }
    }
    return summary;
  }
}

export class SystemEvaluator {
  constructor() {
    this.taskLevelEvaluations = [];
  }

  async evaluateTaskCompletion(taskInstance, agentEvaluations) {
    const { taskId, description, status: taskStatus, result: taskResult, agentCount, overallScore: taskOverallAgentScoreFromIndiv } = taskInstance || {};

    let averageAgentScore = 0;
    let validAgentScoresCount = 0;

    if (agentEvaluations && agentEvaluations.length > 0) {
        const validScores = agentEvaluations
            .map(ae => (ae && ae.evaluation && typeof ae.evaluation.overall === 'number') ? ae.evaluation.overall : undefined)
            .filter(score => score !== undefined);

        if (validScores.length > 0) {
            averageAgentScore = validScores.reduce((sum, score) => sum + score, 0) / validScores.length;
            validAgentScoresCount = validScores.length;
        }
    } else if (typeof taskOverallAgentScoreFromIndiv === 'number') {
        averageAgentScore = taskOverallAgentScoreFromIndiv;
        validAgentScoresCount = agentCount || 1;
    }

    if (!taskId || !description) {
        console.error("SystemEvaluator: Task ID or description missing. Cannot perform system evaluation.", taskInstance);
        const errorEval = {
            taskId: taskId || "unknown",
            taskDescription: description || "N/A",
            taskStatus: taskStatus || "unknown",
            error: "Critical task information missing for system evaluation.",
            systemRating: 1,
            analysis: "System evaluation could not be performed due to missing task details.",
            recommendations: "Ensure task instance is correctly passed to SystemEvaluator.",
            timestamp: new Date().toISOString()
        };
        this.taskLevelEvaluations.push(errorEval);
        return errorEval;
    }

    const systemEvalPrompt = `
      Overall Task Description: ${description}
      Task Status: ${taskStatus}
      Number of Subtasks/Agents Involved: ${agentCount || validAgentScoresCount}
      Average Agent Performance Score (from subtasks): ${averageAgentScore.toFixed(1)}/10 (based on ${validAgentScoresCount} valid agent scores)
      Final Task Result/Output Summary: ${JSON.stringify(taskResult?.agentExecutionReports || taskResult?.result || taskResult || "No result available").substring(0, 1000)}...

      Evaluate the OVERALL success and quality of this multi-agent system in completing the MAIN task. Consider:
      1. Task Completion: Was the main goal achieved effectively? (1=Not achieved, 10=Fully achieved)
      2. Result Quality: How good is the final output in relation to the main task? (1=Very Poor, 10=Excellent)
      3. System Efficiency & Coordination: Did the agents work together effectively (implied by subtask completion, average scores, and final outcome)? (1=Inefficient/Uncoordinated, 10=Highly Efficient/Coordinated)
      4. Robustness: How well did the system handle any errors or unexpected situations (if applicable)? (1=Brittle, 10=Very Robust)

      Provide your system-level rating (1-10 for overall success), a brief analysis, and any recommendations for the system.
      Return as a JSON object: {"systemRating": number, "analysis": "your analysis text", "recommendations": "your recommendations text"}`;

    const systemEvalJson = await getJsonFromLlmResponse(systemEvalPrompt);

    if (systemEvalJson.error) {
        const llmErrorSystemEval = {
            taskId, taskDescription: description, taskStatus, averageAgentScore: parseFloat(averageAgentScore.toFixed(1)),
            systemRating: 1,
            analysis: `LLM error during system evaluation: ${systemEvalJson.reason}`,
            recommendations: "Review LLM interaction for system evaluation.",
            error: "LLM_JSON_PARSING_ERROR_SYSTEM",
            timestamp: new Date().toISOString()
        };
        this.taskLevelEvaluations.push(llmErrorSystemEval);
        return llmErrorSystemEval;
    }

    const finalSystemEvaluation = {
      taskId,
      taskDescription: description,
      taskStatus,
      averageAgentScore: parseFloat(averageAgentScore.toFixed(1)),
      systemRating: typeof systemEvalJson.systemRating === 'number' ? systemEvalJson.systemRating : 1,
      analysis: systemEvalJson.analysis || "Analysis not provided by LLM.",
      recommendations: systemEvalJson.recommendations || "Recommendations not provided by LLM.",
      timestamp: new Date().toISOString()
    };

    this.taskLevelEvaluations.push(finalSystemEvaluation);

    try {
        await storeKnowledgeItem(
            `system_eval_${taskId}`,
            finalSystemEvaluation,
            { type: 'system_task_evaluation', taskId, systemRating: finalSystemEvaluation.systemRating }
        );
    } catch (dbError) {
        console.error(`Failed to store system evaluation for task ${taskId}:`, dbError);
    }

    return finalSystemEvaluation;
  }

  getSystemPerformanceSummary() {
    if (this.taskLevelEvaluations.length === 0) return { count: 0, averageSystemRating: 0, evaluations: [] };
    const ratings = this.taskLevelEvaluations.map(e => e.systemRating).filter(r => typeof r === 'number' && !isNaN(r));
    return {
      count: this.taskLevelEvaluations.length,
      averageSystemRating: ratings.length ? parseFloat((ratings.reduce((s, r) => s + r, 0) / ratings.length).toFixed(1)) : 0,
      evaluations: [...this.taskLevelEvaluations]
    };
  }
}

export function calculateAverageScore(evaluationsArray, scoreField = 'overall') {
    if (!evaluationsArray || evaluationsArray.length === 0) return 0;
    const scores = evaluationsArray
        .map(e => (e && e.evaluation && typeof e.evaluation[scoreField] === 'number') ? e.evaluation[scoreField] : (typeof e[scoreField] === 'number' ? e[scoreField] : undefined) )
        .filter(s => s !== undefined);
    if (scores.length === 0) return 0;
    return parseFloat((scores.reduce((sum, score) => sum + score, 0) / scores.length).toFixed(1));
}