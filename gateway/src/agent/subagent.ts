/**
 * SubAgent 执行器
 * 连接 spawn 工具和 Agent Loop
 * 支持工具限制：SubAgent 使用过滤后的工具注册表
 */

import type { SpawnParams, SpawnResult } from '../tools/spawn';
import { runAgentLoop } from './loop';
import type { ToolRegistry } from '../tools/registry';
import type { LLMProvider, LLMToolCall } from '../llm/provider';
import { Logger } from '../utils/logger';

const log = new Logger('SubAgent');

/**
 * SubAgent 配置
 */
export interface SubAgentConfig {
    /** LLM Provider（可与主 Agent 不同，如使用更便宜的模型） */
    llm: LLMProvider;
    /** 工具注册表（应为过滤后的版本，限制 SubAgent 可用工具） */
    tools: ToolRegistry;
    /** 最大迭代次数（默认 30） */
    maxIterations?: number;
    /** 完成回调（用于汇报给主 Agent） */
    onComplete?: (result: SpawnResult) => void;
    /** 进度回调（用于将子Agent进度传给主会话） */
    onProgress?: (event: { type: string;[key: string]: unknown }) => void;
}

/**
 * SubAgent 系统提示
 */
const SUBAGENT_SYSTEM_PROMPT = `You are a SubAgent created to execute a specific task assigned by the main Agent.

## Your Role
- You were spawned by the main Agent to handle a specific task
- Focus solely on completing the assigned task
- Your output will be automatically reported back to the main Agent

## Tool Usage Rules (Important)
- **Search for information**: MUST use web_search tool. Do NOT use process to run Python/curl for searching
- **Fetch web content**: MUST use web_fetch tool. Do NOT use process to run urllib/requests/curl for fetching
- **File operations**: Use the filesystem tool
- **Execute commands**: Use the process tool (only for scenarios that truly require running local programs)

## Rules
1. Only do the task assigned to you, nothing extra
2. Keep your output concise and clear
3. If the task cannot be completed, clearly explain why
4. Do not try to communicate directly with the user`;

/**
 * 创建 SubAgent 执行函数
 * 用于 spawn 工具的 onExecute 回调
 *
 * 注意：config.tools 应为经过 SubAgent 策略过滤后的工具注册表，
 * 以限制子 Agent 不能使用 scheduler、workflow 等全局资源工具。
 */
export function createSubAgentExecutor(config: SubAgentConfig) {
    const availableTools = config.tools.getToolNames();
    log.info(`SubAgent available tools: [${availableTools.join(', ')}]`);

    return async (params: SpawnParams): Promise<SpawnResult> => {
        const startTime = Date.now();
        log.info(`SubAgent started: ${params.id}`, { task: params.task.slice(0, 100) });

        try {
            // 设置超时
            const timeoutMs = params.timeout * 1000;
            const timeoutPromise = new Promise<never>((_, reject) => {
                setTimeout(() => reject(new Error('Execution timed out')), timeoutMs);
            });

            // 执行 Agent Loop（使用过滤后的工具注册表）
            const executePromise = runAgentLoop(params.task, {
                llm: config.llm,
                tools: config.tools,
                systemPrompt: SUBAGENT_SYSTEM_PROMPT,
                maxIterations: config.maxIterations || Infinity,
                onIteration: (iteration: number) => {
                    log.info(`SubAgent ${params.id} iteration ${iteration}`);
                    config.onProgress?.({
                        type: 'iteration',
                        iteration,
                        subAgentId: params.id,
                    });
                },
                onToolCall: (toolCall: LLMToolCall, result: unknown) => {
                    const args = toolCall.arguments || {};
                    log.info(`SubAgent ${params.id} tool call: ${toolCall.name}`, {
                        action: args.action,
                    });
                    config.onProgress?.({
                        type: 'tool_result',
                        tool: toolCall.name,
                        args,
                        result,
                        subAgentId: params.id,
                    });
                },
                onToolStart: (description: string, toolCalls: LLMToolCall[], llmContent?: string) => {
                    config.onProgress?.({
                        type: 'tool_start',
                        description: `[SubAgent] ${description}`,
                        subAgentId: params.id,
                    });
                },
            });

            // 竞争：执行 vs 超时
            const result = await Promise.race([executePromise, timeoutPromise]);

            const duration = Date.now() - startTime;
            log.info(`SubAgent completed: ${params.id}`, { duration, iterations: result.iterations });

            const spawnResult: SpawnResult = {
                id: params.id,
                status: 'completed',
                output: result.output,
                duration,
            };

            config.onComplete?.(spawnResult);
            return spawnResult;

        } catch (error) {
            const duration = Date.now() - startTime;
            const errorMsg = error instanceof Error ? error.message : String(error);
            const isTimeout = errorMsg === 'Execution timed out';

            log.error(`SubAgent ${isTimeout ? 'timed out' : 'failed'}: ${params.id}`, { error: errorMsg });

            const spawnResult: SpawnResult = {
                id: params.id,
                status: isTimeout ? 'timeout' : 'failed',
                error: errorMsg,
                duration,
            };

            config.onComplete?.(spawnResult);
            return spawnResult;
        }
    };
}

/**
 * 格式化 SubAgent 结果用于汇报
 */
export function formatSubAgentReport(result: SpawnResult): string {
    const statusText = {
        completed: '✅ 完成',
        failed: '❌ 失败',
        timeout: '⏰ 超时',
    }[result.status];

    const durationText = result.duration
        ? `${(result.duration / 1000).toFixed(1)}s`
        : 'N/A';

    let report = `子任务 ${result.id} ${statusText} (耗时 ${durationText})`;

    if (result.output) {
        report += `\n\n结果:\n${result.output}`;
    }

    if (result.error) {
        report += `\n\n错误: ${result.error}`;
    }

    return report;
}
