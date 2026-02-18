import { describe, expect, it } from 'bun:test';
import type { ExtendedLLMMessage } from '../../apps/api/src/services/llm';
import { processAgentTurn } from '../../apps/api/src/routes/stream';

function createMockStream(events: Array<any>) {
  return {
    async writeSSE(payload: { data: string }) {
      try {
        events.push(JSON.parse(payload.data));
      } catch {
        events.push(payload.data);
      }
    },
  };
}

describe('processAgentTurn video routing guard', () => {
  it('retries video-tool routing and then fails safely when model never calls tools', async () => {
    const events: any[] = [];
    const llmCalls: Array<ExtendedLLMMessage[]> = [];
    let callCount = 0;

    const llmClient = {
      async *streamChat(messages: ExtendedLLMMessage[]) {
        llmCalls.push(messages);
        callCount += 1;
        yield {
          type: 'content' as const,
          content:
            callCount === 1
              ? 'The user wants to know the marginal propensity to consume.'
              : 'Final answer without using any tools.',
        };
        yield { type: 'done' as const, finishReason: 'stop' };
      },
    };

    const taskManager = {
      getTaskState: () => ({
        goal: {
          videoUrl: 'https://www.bilibili.com/video/BV1GqcWzuELB',
          requiresVideoProbe: true,
          requiresVideoDownload: false,
          requiresTranscript: true,
        },
      }),
      getToolCallDecision: () => ({ allowed: true }),
      recordToolCall: () => {},
    };

    const result = await processAgentTurn(
      'session-video-guard',
      [{ role: 'user', content: 'summarize this video URL' }],
      [],
      { sessionId: 'session-video-guard', userId: 'u1', workspaceDir: '/tmp' },
      taskManager,
      { toolCall: { create: async () => ({}) } },
      llmClient,
      { execute: async () => ({ success: true, output: '' }) },
      createMockStream(events),
      Date.now(),
      5
    );

    expect(result.content).toContain('required video tools were not executed');
    expect(result.content).toContain('video_probe and video_transcript');
    expect(result.content).not.toContain('marginal propensity to consume');
    expect(callCount).toBe(3);

    const leakedDraftDelta = events.some(
      (event) =>
        event?.type === 'message.delta' &&
        typeof event?.data?.content === 'string' &&
        event.data.content.includes('marginal propensity to consume')
    );
    expect(leakedDraftDelta).toBe(false);

    const lastPrompt = llmCalls[1] || [];
    const hasReminderSystemMessage = lastPrompt.some(
      (message) =>
        message.role === 'system' &&
        typeof message.content === 'string' &&
        message.content.includes('Run the relevant video tools first')
    );
    expect(hasReminderSystemMessage).toBe(true);
  });

  it('does not treat historical tool messages as current-turn video tool execution', async () => {
    const events: any[] = [];
    let callCount = 0;

    const llmClient = {
      async *streamChat() {
        callCount += 1;
        yield {
          type: 'content' as const,
          content: 'Here is a generic answer without running tools.',
        };
        yield { type: 'done' as const, finishReason: 'stop' };
      },
    };

    const taskManager = {
      getTaskState: () => ({
        goal: {
          videoUrl: 'https://www.bilibili.com/video/BV1GqcWzuELB',
          requiresVideoProbe: true,
          requiresVideoDownload: false,
          requiresTranscript: true,
        },
      }),
      getToolCallDecision: () => ({ allowed: true }),
      recordToolCall: () => {},
    };

    const result = await processAgentTurn(
      'session-video-guard-historical-tool',
      [
        { role: 'user', content: 'previous turn context' },
        { role: 'assistant', content: 'previous tool usage' },
        { role: 'tool', content: '{"success":true}', tool_call_id: 'old-tool-call' },
        { role: 'user', content: 'summarize this video URL' },
      ],
      [],
      { sessionId: 'session-video-guard-historical-tool', userId: 'u1', workspaceDir: '/tmp' },
      taskManager,
      { toolCall: { create: async () => ({}) } },
      llmClient,
      { execute: async () => ({ success: true, output: '' }) },
      createMockStream(events),
      Date.now(),
      5
    );

    expect(result.content).toContain('required video tools were not executed');
    expect(callCount).toBe(3);
  });

  it('strips think tags from final non-tool output', async () => {
    const events: any[] = [];

    const llmClient = {
      async *streamChat() {
        yield {
          type: 'content' as const,
          content: '<think>internal notes</think>Final answer for the user.',
        };
        yield { type: 'done' as const, finishReason: 'stop' };
      },
    };

    const taskManager = {
      getTaskState: () => ({
        goal: {
          requiresVideoProbe: false,
          requiresVideoDownload: false,
          requiresTranscript: false,
        },
      }),
      getToolCallDecision: () => ({ allowed: true }),
      recordToolCall: () => {},
    };

    const result = await processAgentTurn(
      'session-think-sanitize',
      [{ role: 'user', content: 'hello' }],
      [],
      { sessionId: 'session-think-sanitize', userId: 'u1', workspaceDir: '/tmp' },
      taskManager,
      { toolCall: { create: async () => ({}) } },
      llmClient,
      { execute: async () => ({ success: true, output: '' }) },
      createMockStream(events),
      Date.now(),
      3
    );

    expect(result.content).toBe('Final answer for the user.');
    expect(result.content).not.toContain('<think>');
  });

  it('retries when video_probe succeeds but video_transcript is never called', async () => {
    const events: any[] = [];
    const llmCalls: Array<ExtendedLLMMessage[]> = [];
    let callCount = 0;

    const llmClient = {
      async *streamChat(messages: ExtendedLLMMessage[]) {
        llmCalls.push([...messages]);
        callCount += 1;
        if (callCount === 1) {
          // First pass: LLM calls video_probe only
          yield {
            type: 'tool_call' as const,
            toolCall: {
              id: 'tc-probe',
              name: 'video_probe',
              arguments: JSON.stringify({ url: 'https://www.bilibili.com/video/BV1GqcWzuELB' }),
            },
          };
          yield { type: 'done' as const, finishReason: 'tool_calls' };
          return;
        }
        // Subsequent passes: LLM writes text without calling video_transcript
        yield {
          type: 'content' as const,
          content: 'Here is a fabricated summary based on the video title and description metadata.',
        };
        yield { type: 'done' as const, finishReason: 'stop' };
      },
    };

    const taskManager = {
      getTaskState: () => ({
        goal: {
          videoUrl: 'https://www.bilibili.com/video/BV1GqcWzuELB',
          requiresVideoProbe: true,
          requiresVideoDownload: false,
          requiresTranscript: true,
          description: 'summarize this video',
        },
      }),
      getToolCallDecision: () => ({ allowed: true }),
      recordToolCall: () => {},
    };

    const result = await processAgentTurn(
      'session-video-probe-only',
      [{ role: 'user', content: 'summarize this video URL' }],
      [],
      { sessionId: 'session-video-probe-only', userId: 'u1', workspaceDir: '/tmp' },
      taskManager,
      { toolCall: { create: async () => ({}) } },
      llmClient,
      {
        execute: async (tool: string, params: Record<string, any>) => {
          if (tool === 'video_probe') {
            return {
              success: true,
              output: JSON.stringify({ title: 'Test Video', description: 'A test video', duration: 120 }),
              duration: 5,
            };
          }
          return { success: true, output: '', duration: 1 };
        },
      },
      createMockStream(events),
      Date.now(),
      5
    );

    // The guard should NOT let the fabricated summary through.
    // After retries are exhausted, it should return the hard-fail message.
    expect(result.content).not.toContain('fabricated summary');
    // Should contain either the hard-fail message or the fabrication-detection message
    const hasFailMessage =
      result.content.includes('required video tools were not executed') ||
      result.content.includes('unable to extract the video transcript');
    expect(hasFailMessage).toBe(true);
    // LLM should have been called more than once (retry happened)
    expect(callCount).toBeGreaterThan(1);
  });

  it('forces includeTimestamps=true for video_transcript in transcript-required tasks', async () => {
    const events: any[] = [];
    const executedParams: Array<Record<string, any>> = [];
    let llmCall = 0;

    const llmClient = {
      async *streamChat() {
        llmCall += 1;
        if (llmCall === 1) {
          yield {
            type: 'tool_call' as const,
            toolCall: {
              id: 'tc-video',
              name: 'video_transcript',
              arguments: JSON.stringify({
                url: 'https://www.bilibili.com/video/BV1GqcWzuELB',
                includeTimestamps: false,
              }),
            },
          };
          yield { type: 'done' as const, finishReason: 'tool_calls' };
          return;
        }

        yield { type: 'content' as const, content: 'Final transcript-based summary.' };
        yield { type: 'done' as const, finishReason: 'stop' };
      },
    };

    const taskManager = {
      getTaskState: () => ({
        goal: {
          videoUrl: 'https://www.bilibili.com/video/BV1GqcWzuELB',
          requiresVideoProbe: true,
          requiresVideoDownload: false,
          requiresTranscript: true,
          description: 'summarize this video',
        },
      }),
      getToolCallDecision: () => ({ allowed: true }),
      recordToolCall: () => {},
    };

    const result = await processAgentTurn(
      'session-video-force-ts',
      [{ role: 'user', content: 'summarize this video URL' }],
      [],
      { sessionId: 'session-video-force-ts', userId: 'u1', workspaceDir: '/tmp' },
      taskManager,
      { toolCall: { create: async () => ({}) } },
      llmClient,
      {
        execute: async (_tool: string, params: Record<string, any>) => {
          executedParams.push(params);
          return {
            success: true,
            output:
              'Transcript extraction completed.\n--- Transcript ---\n[00:00:00.000 --> 00:00:01.000] hello',
            duration: 10,
          };
        },
      },
      createMockStream(events),
      Date.now(),
      5
    );

    expect(result.content.toLowerCase()).toContain('transcript');
    expect(executedParams.length).toBe(1);
    expect(executedParams[0].includeTimestamps).toBe(true);
  });

  it('detects fabricated summary when transcript succeeded but response ignores transcript content', async () => {
    const events: any[] = [];
    let llmCall = 0;
    const llmCalls: Array<ExtendedLLMMessage[]> = [];

    const realTranscript = [
      '--- Transcript ---',
      '[00:00:00.000 --> 00:00:05.000] 大家好，今天我们来对比一下几个AI编程模型',
      '[00:00:05.000 --> 00:00:12.000] GLM5 Claude Opus and GPT Codex comparison',
      '[00:00:12.000 --> 00:00:20.000] 我们先来看看 MiniMax M2.5 的表现',
      '[00:00:20.000 --> 00:00:30.000] coding benchmark results show significant differences',
      '[00:00:30.000 --> 00:00:40.000] 在代码生成任务中 GLM5 表现最好',
    ].join('\n');

    const llmClient = {
      async *streamChat(messages: ExtendedLLMMessage[]) {
        llmCall += 1;
        llmCalls.push([...messages]);
        if (llmCall === 1) {
          // First pass: LLM calls video_transcript
          yield {
            type: 'tool_call' as const,
            toolCall: {
              id: 'tc-transcript',
              name: 'video_transcript',
              arguments: JSON.stringify({
                url: 'https://www.bilibili.com/video/BV1GqcWzuELB',
                includeTimestamps: true,
              }),
            },
          };
          yield { type: 'done' as const, finishReason: 'tool_calls' };
          return;
        }
        // Subsequent passes: LLM ignores transcript and fabricates unrelated content
        yield {
          type: 'content' as const,
          content:
            'This video is a comprehensive tutorial on building a MERN stack chatbot application. ' +
            'The instructor walks through setting up MongoDB, Express, React, and Node.js to create ' +
            'a full-featured chatbot with natural language processing capabilities.',
        };
        yield { type: 'done' as const, finishReason: 'stop' };
      },
    };

    const taskManager = {
      getTaskState: () => ({
        goal: {
          videoUrl: 'https://www.bilibili.com/video/BV1GqcWzuELB',
          requiresVideoProbe: true,
          requiresVideoDownload: false,
          requiresTranscript: true,
          description: 'summarize this video',
        },
      }),
      getToolCallDecision: () => ({ allowed: true }),
      recordToolCall: () => {},
    };

    const result = await processAgentTurn(
      'session-video-grounding',
      [{ role: 'user', content: 'summarize this video URL' }],
      [],
      { sessionId: 'session-video-grounding', userId: 'u1', workspaceDir: '/tmp' },
      taskManager,
      { toolCall: { create: async () => ({}) } },
      llmClient,
      {
        execute: async (tool: string) => {
          if (tool === 'video_transcript') {
            return {
              success: true,
              output: `Transcript extraction completed.\n${realTranscript}`,
              duration: 10,
            };
          }
          return { success: true, output: '', duration: 1 };
        },
      },
      createMockStream(events),
      Date.now(),
      6  // Allow enough steps for: tool call + fabricated + retry + fabricated again
    );

    // With transcript QA engine, flow should terminate without endless retries.
    // Extra call is used by LLM-first transcript query understanding.
    expect(llmCall).toBe(3);

    // Should return transcript-grounded fallback instead of the fabricated MERN content.
    expect(result.content.toLowerCase()).toContain('transcript');
    expect(result.content).toContain('[00:00:00.000 --> 00:00:05.000]');
    expect(result.content).toContain('大家好，今天我们来对比一下几个AI编程模型');
    expect(result.content).not.toContain('MERN stack');
    expect(result.content).not.toContain('chatbot application');

    // Verify transcript-grounded fallback is emitted via SSE
    const hasGroundingFallbackEvent = events.some(
      (event) =>
        event?.type === 'message.delta' &&
        typeof event?.data?.content === 'string' &&
        event.data.content.includes('[00:00:00.000 --> 00:00:05.000]')
    );
    expect(hasGroundingFallbackEvent).toBe(true);
  });

  it('does not treat correct English summary of predominantly Chinese transcript as grounding failure', async () => {
    const events: any[] = [];
    let llmCall = 0;

    // Predominantly CJK transcript (so overlap with English summary will be near zero)
    const chineseTranscript = [
      '--- Transcript ---',
      '[00:00:00.040 --> 00:00:01.040] 这临近过年',
      '[00:00:01.040 --> 00:00:02.800] 我们的国产模型真的太猛了',
      '[00:00:02.800 --> 00:00:03.960] 前面我做过两期视频',
      '[00:00:03.960 --> 00:00:05.040] 用同样的BRT',
      '[00:00:05.040 --> 00:00:06.960] 同样的真实项目任务实测',
      '[00:00:06.960 --> 00:00:08.840] 对比了cloud os4.6',
      '[00:00:08.840 --> 00:00:09.880] G p t5.3',
      '[00:00:09.880 --> 00:00:12.260] Codex mini max m2.5',
      '[00:00:12.260 --> 00:00:13.540] 那期视频做完之后',
      '[00:00:13.540 --> 00:00:16.680] 评论区就有人让我测试一下质谱新发布的模型',
      '[00:00:16.680 --> 00:00:17.610] G o m5',
    ].join('\n');

    const correctEnglishSummary =
      'Summary: This video compares domestic AI models using the same BRT and real project tasks. ' +
      'It covers Cloud OS 4.6, GPT 5.3, Codex, MiniMax M2.5, and Zhipu’s newly released GLM-5 model.';

    const llmClient = {
      async *streamChat(messages: ExtendedLLMMessage[]) {
        llmCall += 1;
        if (llmCall === 1) {
          yield {
            type: 'tool_call' as const,
            toolCall: {
              id: 'tc-transcript',
              name: 'video_transcript',
              arguments: JSON.stringify({
                url: 'https://www.bilibili.com/video/BV1GqcWzuELB',
                includeTimestamps: true,
              }),
            },
          };
          yield { type: 'done' as const, finishReason: 'tool_calls' };
          return;
        }
        yield { type: 'content' as const, content: correctEnglishSummary };
        yield { type: 'done' as const, finishReason: 'stop' };
      },
    };

    const taskManager = {
      getTaskState: () => ({
        goal: {
          videoUrl: 'https://www.bilibili.com/video/BV1GqcWzuELB',
          requiresVideoProbe: true,
          requiresVideoDownload: false,
          requiresTranscript: true,
          description: 'summarize this video',
        },
      }),
      getToolCallDecision: () => ({ allowed: true }),
      recordToolCall: () => {},
    };

    const result = await processAgentTurn(
      'session-cjk-summary',
      [{ role: 'user', content: 'please make a summary for this video: https://www.bilibili.com/video/BV1GqcWzuELB' }],
      [],
      { sessionId: 'session-cjk-summary', userId: 'u1', workspaceDir: '/tmp' },
      taskManager,
      { toolCall: { create: async () => ({}) } },
      llmClient,
      {
        execute: async (tool: string) => {
          if (tool === 'video_transcript') {
            return {
              success: true,
              output: `Transcript extraction completed.\n${chineseTranscript}`,
              duration: 10,
            };
          }
          return { success: true, output: '', duration: 1 };
        },
      },
      createMockStream(events),
      Date.now(),
      5
    );

    expect(llmCall).toBeGreaterThanOrEqual(2);
    expect(result.content.length).toBeGreaterThan(40);
    expect(result.content).not.toContain('direct transcript-grounded excerpts');
    expect(result.content).not.toContain('基于完整 transcript 的总结：');
    expect(result.content).not.toContain('not appear to be grounded');
    expect(result.content).not.toContain('Please retry');

    const hasGroundingFailEvent = events.some(
      (event) =>
        event?.type === 'message.delta' &&
        typeof event?.data?.content === 'string' &&
        event.data.content.includes('not appear to be grounded')
    );
    expect(hasGroundingFailEvent).toBe(false);
  });

  it('detects incomplete early-only timeline summary and falls back with full-timeline transcript excerpts', async () => {
    const events: any[] = [];
    const llmCalls: Array<ExtendedLLMMessage[]> = [];
    let llmCall = 0;

    const fullTranscript = [
      '--- Transcript ---',
      '[00:00:00.040 --> 00:00:01.560] 最近skill真的特别火',
      '[00:01:30.000 --> 00:01:40.000] 我们先讲为什么大多数教程讲不清楚底层机制',
      '[00:03:10.000 --> 00:03:22.000] 接下来进入agent结构设计和工具编排',
      '[00:05:40.000 --> 00:05:58.000] 这里展示运行日志和中间状态',
      '[00:07:45.000 --> 00:08:12.000] 后半段讲解如何做错误恢复和重试控制',
      '[00:10:20.000 --> 00:10:48.000] 然后讲如何验证summary是否真正基于transcript',
      '[00:12:30.000 --> 00:12:42.000] 最后总结完整流程和注意事项',
    ].join('\n');

    const badEarlyOnlySummary =
      'The video features a Chinese-speaking host who demonstrates how to create a starry sky effect. ' +
      'Key segments are 0:00-1:30 setup, 1:30-3:00 Stable Diffusion config, 3:00-4:30 rendering, and 4:30-6:00 Premiere editing.';

    const llmClient = {
      async *streamChat(messages: ExtendedLLMMessage[]) {
        llmCall += 1;
        llmCalls.push([...messages]);
        if (llmCall === 1) {
          yield {
            type: 'tool_call' as const,
            toolCall: {
              id: 'tc-transcript-full-coverage',
              name: 'video_transcript',
              arguments: JSON.stringify({
                url: 'https://www.bilibili.com/video/BV1ZpzhBLE82',
                includeTimestamps: true,
              }),
            },
          };
          yield { type: 'done' as const, finishReason: 'tool_calls' };
          return;
        }
        yield { type: 'content' as const, content: badEarlyOnlySummary };
        yield { type: 'done' as const, finishReason: 'stop' };
      },
    };

    const taskManager = {
      getTaskState: () => ({
        goal: {
          videoUrl: 'https://www.bilibili.com/video/BV1ZpzhBLE82',
          requiresVideoProbe: true,
          requiresVideoDownload: false,
          requiresTranscript: true,
          description: '请分析总结这个视频： https://www.bilibili.com/video/BV1ZpzhBLE82',
        },
      }),
      getToolCallDecision: () => ({ allowed: true }),
      recordToolCall: () => {},
    };

    const result = await processAgentTurn(
      'session-incomplete-timeline-coverage',
      [{ role: 'user', content: '请分析总结这个视频： https://www.bilibili.com/video/BV1ZpzhBLE82' }],
      [],
      { sessionId: 'session-incomplete-timeline-coverage', userId: 'u1', workspaceDir: '/tmp' },
      taskManager,
      { toolCall: { create: async () => ({}) } },
      llmClient,
      {
        execute: async (tool: string) => {
          if (tool === 'video_transcript') {
            return {
              success: true,
              output: `Transcript extraction completed.\n${fullTranscript}`,
              duration: 10,
            };
          }
          return { success: true, output: '', duration: 1 };
        },
      },
      createMockStream(events),
      Date.now(),
      6
    );

    expect(llmCall).toBe(3);
    expect(result.content).toContain('transcript');
    expect(result.content).toContain('[00:12:30.000 --> 00:12:42.000]');
    expect(result.content).not.toContain('starry sky effect');

    const hasFallbackEvent = events.some(
      (event) =>
        event?.type === 'message.delta' &&
        typeof event?.data?.content === 'string' &&
        event.data.content.includes('00:12:30.000 --> 00:12:42.000')
    );
    expect(hasFallbackEvent).toBe(true);
  });

  it('uses transcript QA fallback to return transcript-grounded summary', async () => {
    const events: any[] = [];
    let llmCall = 0;

    const transcript = [
      '--- Transcript ---',
      '[00:00:00.040 --> 00:00:01.560] 最近skill真的特别火',
      '[00:02:10.000 --> 00:02:40.000] 这里讲到skill触发机制和依赖注入',
      '[00:05:20.000 --> 00:05:50.000] 演示如何把项目一步一步跑起来',
      '[00:08:15.000 --> 00:08:55.000] 解释agent和tool之间的交互链路',
      '[00:10:45.000 --> 00:11:20.000] 说明工具调用和错误恢复策略',
      '[00:12:30.000 --> 00:12:42.000] 最后总结完整流程并结束',
    ].join('\n');

    const badSummary =
      'This video is about creating a starry-sky visual effect with Stable Diffusion and Premiere Pro. ' +
      'It focuses on visual rendering, software configuration, and export steps that do not match the transcript. ' +
      'Timeline: 0:00-2:00 introduction, 2:00-4:00 setup, 4:00-6:00 editing.';
    const llmClient = {
      async *streamChat(messages: ExtendedLLMMessage[]) {
        llmCall += 1;
        if (llmCall === 1) {
          yield {
            type: 'tool_call' as const,
            toolCall: {
              id: 'tc-transcript-forced',
              name: 'video_transcript',
              arguments: JSON.stringify({
                url: 'https://www.bilibili.com/video/BV1ZpzhBLE82',
                includeTimestamps: true,
              }),
            },
          };
          yield { type: 'done' as const, finishReason: 'tool_calls' };
          return;
        }
        yield { type: 'content' as const, content: badSummary };
        yield { type: 'done' as const, finishReason: 'stop' };
      },
    };

    const taskManager = {
      getTaskState: () => ({
        goal: {
          videoUrl: 'https://www.bilibili.com/video/BV1ZpzhBLE82',
          requiresVideoProbe: true,
          requiresVideoDownload: false,
          requiresTranscript: true,
          description: '请分析总结这个视频： https://www.bilibili.com/video/BV1ZpzhBLE82',
        },
      }),
      getToolCallDecision: () => ({ allowed: true }),
      recordToolCall: () => {},
    };

    const result = await processAgentTurn(
      'session-forced-transcript-summary',
      [{ role: 'user', content: '请分析总结这个视频： https://www.bilibili.com/video/BV1ZpzhBLE82' }],
      [],
      { sessionId: 'session-forced-transcript-summary', userId: 'u1', workspaceDir: '/tmp' },
      taskManager,
      { toolCall: { create: async () => ({}) } },
      llmClient,
      {
        execute: async (tool: string) => {
          if (tool === 'video_transcript') {
            return {
              success: true,
              output: `Transcript extraction completed.\n${transcript}`,
              duration: 10,
            };
          }
          return { success: true, output: '', duration: 1 };
        },
      },
      createMockStream(events),
      Date.now(),
      7
    );

    expect(llmCall).toBe(3);
    expect(result.content).toContain('transcript');
    expect(result.content).toContain('[00:12:30.000 --> 00:12:42.000]');
    expect(result.content).not.toContain('direct transcript-grounded excerpts');
    expect(result.content).not.toContain('starry-sky visual effect');

    const hasForcedSummaryEvent = events.some(
      (event) =>
        event?.type === 'message.delta' &&
        typeof event?.data?.content === 'string' &&
        event.data.content.includes('[00:12:30.000 --> 00:12:42.000]')
    );
    expect(hasForcedSummaryEvent).toBe(true);
  });

  it('real bilibili regression: should not return metadata-based hallucinated summary', async () => {
    const events: any[] = [];
    let llmCall = 0;

    const transcript = [
      '--- Transcript ---',
      '[00:00:00.040 --> 00:00:01.560] 最近skill真的特别火',
      '[00:01:26.400 --> 00:01:27.960] 第二层那触发时',
      '[00:02:44.320 --> 00:02:45.320] 包含了一个指定内容',
      '[00:04:07.700 --> 00:04:09.980] 就是我这个里面已经安装的好',
      '[00:05:29.619 --> 00:05:31.499] 一步一步的把我们这个项目跑起来',
      '[00:06:59.760 --> 00:07:01.000] 按量付费就还好',
      '[00:08:30.670 --> 00:08:34.130] 完全的去理解它整个的一个交互的一个过程了',
      '[00:10:03.670 --> 00:10:04.430] 做工具调用',
      '[00:11:26.260 --> 00:11:28.260] 那下面呢就是一个普通的一个',
      '[00:12:40.900 --> 00:12:41.820] 拜拜拜拜',
    ].join('\n');

    const wrongSummaryFromMetadata = [
      'The video features a Chinese-speaking host who demonstrates how to create a "starry sky" effect.',
      'Stable Diffusion configuration and Premiere editing are discussed from 0:00 to 6:00.',
      'The workflow focuses on rendering images and composing them into an animation.',
    ].join(' ');

    const llmClient = {
      async *streamChat(messages: ExtendedLLMMessage[]) {
        llmCall += 1;
        if (llmCall === 1) {
          yield {
            type: 'tool_call' as const,
            toolCall: {
              id: 'tc-regression-transcript',
              name: 'video_transcript',
              arguments: JSON.stringify({
                url: 'https://www.bilibili.com/video/BV1ZpzhBLE82',
                includeTimestamps: true,
              }),
            },
          };
          yield { type: 'done' as const, finishReason: 'tool_calls' };
          return;
        }
        yield { type: 'content' as const, content: wrongSummaryFromMetadata };
        yield { type: 'done' as const, finishReason: 'stop' };
      },
    };

    const taskManager = {
      getTaskState: () => ({
        goal: {
          videoUrl: 'https://www.bilibili.com/video/BV1ZpzhBLE82',
          requiresVideoProbe: true,
          requiresVideoDownload: false,
          requiresTranscript: true,
          description: '请分析总结这个视频： https://www.bilibili.com/video/BV1ZpzhBLE82',
        },
      }),
      getToolCallDecision: () => ({ allowed: true }),
      recordToolCall: () => {},
    };

    const result = await processAgentTurn(
      'session-real-bilibili-regression',
      [{ role: 'user', content: '请分析总结这个视频： https://www.bilibili.com/video/BV1ZpzhBLE82' }],
      [],
      { sessionId: 'session-real-bilibili-regression', userId: 'u1', workspaceDir: '/tmp' },
      taskManager,
      { toolCall: { create: async () => ({}) } },
      llmClient,
      {
        execute: async (tool: string) => {
          if (tool === 'video_transcript') {
            return {
              success: true,
              output: `Transcript extraction completed.\n${transcript}`,
              duration: 10,
            };
          }
          return { success: true, output: '', duration: 1 };
        },
      },
      createMockStream(events),
      Date.now(),
      7
    );

    expect(result.content).toContain('transcript');
    expect(result.content).toContain('skill');
    expect(result.content).toContain('工具调用');
    expect(result.content).not.toContain('direct transcript-grounded excerpts');
    expect(result.content).not.toContain('starry sky');

    const hasRawExcerptFallback = events.some(
      (event) =>
        event?.type === 'message.delta' &&
        typeof event?.data?.content === 'string' &&
        event.data.content.includes('direct transcript-grounded excerpts')
    );
    expect(hasRawExcerptFallback).toBe(false);
  });

  it('refuses out-of-transcript follow-up questions in video-content mode', async () => {
    const events: any[] = [];
    const transcript = [
      '--- Transcript ---',
      '[00:00:00.040 --> 00:00:01.560] 最近skill真的特别火',
      '[00:05:29.619 --> 00:05:31.499] 一步一步的把我们这个项目跑起来',
      '[00:10:03.670 --> 00:10:04.430] 做工具调用',
      '[00:12:40.900 --> 00:12:41.820] 拜拜拜拜',
    ].join('\n');

    const llmClient = {
      async *streamChat() {
        yield {
          type: 'content' as const,
          content:
            '这个视频提到了摩斯密码和二进制解码，核心是信息隐藏和编码传输。',
        };
        yield { type: 'done' as const, finishReason: 'stop' };
      },
    };

    const taskManager = {
      getTaskState: () => ({
        goal: {
          requiresVideoProbe: false,
          requiresVideoDownload: false,
          requiresTranscript: false,
          description: '这个视频里有摩斯密码吗？',
        },
      }),
      getToolCallDecision: () => ({ allowed: true }),
      recordToolCall: () => {},
    };

    const result = await processAgentTurn(
      'session-refuse-out-of-transcript',
      [
        {
          role: 'tool',
          content: JSON.stringify({
            success: true,
            output: `Transcript extraction completed.\n${transcript}`,
            artifacts: [],
          }),
          tool_call_id: 'historical-transcript',
        },
        { role: 'user', content: '这个视频里有摩斯密码吗？' },
      ],
      [],
      { sessionId: 'session-refuse-out-of-transcript', userId: 'u1', workspaceDir: '/tmp' },
      taskManager,
      { toolCall: { create: async () => ({}) } },
      llmClient,
      { execute: async () => ({ success: true, output: '', duration: 1 }) },
      createMockStream(events),
      Date.now(),
      4
    );

    expect(result.content).toContain('缺少足够证据');
    expect(result.content).not.toContain('摩斯密码和二进制解码');

    const hasRefusalEvent = events.some(
      (event) =>
        event?.type === 'message.delta' &&
        typeof event?.data?.content === 'string' &&
        event.data.content.includes('缺少足够证据')
    );
    expect(hasRefusalEvent).toBe(true);
  });

  it('answers timestamp range follow-up directly from transcript instead of refusing', async () => {
    const events: any[] = [];
    const transcript = [
      '--- Transcript ---',
      '[00:08:30.670 --> 00:08:34.130] 完全的去理解它整个的一个交互的一个过程了',
      '[00:08:39.299 --> 00:08:40.970] 其实这个代码并不难',
      '[00:08:45.770 --> 00:08:47.670] 然后我们定义了一些工具',
      '[00:09:03.390 --> 00:09:05.070] 第二个是bash',
      '[00:10:03.670 --> 00:10:04.430] 做工具调用',
    ].join('\n');

    const llmClient = {
      async *streamChat() {
        yield {
          type: 'content' as const,
          content: '这个视频提到了摩斯密码和二进制解码。',
        };
        yield { type: 'done' as const, finishReason: 'stop' };
      },
    };

    const query = '视频8分30秒到9分05秒，讲了啥';
    const taskManager = {
      getTaskState: () => ({
        goal: {
          requiresVideoProbe: false,
          requiresVideoDownload: false,
          requiresTranscript: false,
          description: query,
        },
      }),
      getToolCallDecision: () => ({ allowed: true }),
      recordToolCall: () => {},
    };

    const result = await processAgentTurn(
      'session-time-range-followup',
      [
        {
          role: 'tool',
          content: JSON.stringify({
            success: true,
            output: `Transcript extraction completed.\n${transcript}`,
            artifacts: [],
          }),
          tool_call_id: 'historical-transcript',
        },
        { role: 'user', content: query },
      ],
      [],
      { sessionId: 'session-time-range-followup', userId: 'u1', workspaceDir: '/tmp' },
      taskManager,
      { toolCall: { create: async () => ({}) } },
      llmClient,
      { execute: async () => ({ success: true, output: '', duration: 1 }) },
      createMockStream(events),
      Date.now(),
      4
    );

    expect(result.content).toContain('08:30-09:05');
    expect(result.content).toContain('[00:08:30.670 --> 00:08:34.130]');
    expect(result.content).toContain('[00:09:03.390 --> 00:09:05.070]');
    expect(result.content).not.toContain('证据不一致');
  });

  it('answers broad follow-up summary phrasing from transcript context', async () => {
    const events: any[] = [];
    const transcript = [
      '--- Transcript ---',
      '[00:00:00.040 --> 00:00:01.560] Recently, skills have been really trending',
      '[00:01:29.640 --> 00:01:30.920] Let us look at startup behavior',
      '[00:05:29.619 --> 00:05:31.499] We run the project step by step',
      '[00:10:03.670 --> 00:10:04.430] perform tool invocation',
      '[00:12:40.900 --> 00:12:41.820] bye bye',
    ].join('\n');

    const llmClient = {
      async *streamChat() {
        yield { type: 'content' as const, content: 'generic response' };
        yield { type: 'done' as const, finishReason: 'stop' };
      },
      async embedTexts(texts: string[]) {
        return texts.map((text) => {
          const v = new Array<number>(16).fill(0);
          for (let i = 0; i < text.length; i += 1) v[i % 16] += (text.charCodeAt(i) % 23) / 23;
          return v;
        });
      },
    };

    const query = '介绍这个视频的重点内容';
    const taskManager = {
      getTaskState: () => ({
        goal: {
          requiresVideoProbe: false,
          requiresVideoDownload: false,
          requiresTranscript: false,
          description: query,
        },
      }),
      getToolCallDecision: () => ({ allowed: true }),
      recordToolCall: () => {},
    };

    const result = await processAgentTurn(
      'session-broad-followup-summary',
      [
        {
          role: 'tool',
          content: JSON.stringify({
            success: true,
            output: `Transcript extraction completed.\n${transcript}`,
            artifacts: [],
          }),
          tool_call_id: 'historical-transcript',
        },
        { role: 'user', content: query },
      ],
      [],
      { sessionId: 'session-broad-followup-summary', userId: 'u1', workspaceDir: '/tmp' },
      taskManager,
      { toolCall: { create: async () => ({}) } },
      llmClient as any,
      { execute: async () => ({ success: true, output: '', duration: 1 }) },
      createMockStream(events),
      Date.now(),
      4
    );

    expect(result.content.toLowerCase()).toContain('transcript');
    expect(result.content).toContain('[00:10:03.670 --> 00:10:04.430]');
    expect(result.content).not.toContain('缺少足够证据');
  });

  it('returns explicit no-match message for timestamp range when transcript has no lines there', async () => {
    const events: any[] = [];
    const transcript = [
      '--- Transcript ---',
      '[00:08:30.670 --> 00:08:34.130] 完全的去理解它整个的一个交互的一个过程了',
      '[00:10:03.670 --> 00:10:04.430] 做工具调用',
    ].join('\n');

    const llmClient = {
      async *streamChat() {
        yield { type: 'content' as const, content: '随便回答一段不相关内容。' };
        yield { type: 'done' as const, finishReason: 'stop' };
      },
    };

    const query = '视频00:30到00:40讲了啥';
    const taskManager = {
      getTaskState: () => ({
        goal: {
          requiresVideoProbe: false,
          requiresVideoDownload: false,
          requiresTranscript: false,
          description: query,
        },
      }),
      getToolCallDecision: () => ({ allowed: true }),
      recordToolCall: () => {},
    };

    const result = await processAgentTurn(
      'session-time-range-no-match',
      [
        {
          role: 'tool',
          content: JSON.stringify({
            success: true,
            output: `Transcript extraction completed.\n${transcript}`,
            artifacts: [],
          }),
          tool_call_id: 'historical-transcript',
        },
        { role: 'user', content: query },
      ],
      [],
      { sessionId: 'session-time-range-no-match', userId: 'u1', workspaceDir: '/tmp' },
      taskManager,
      { toolCall: { create: async () => ({}) } },
      llmClient,
      { execute: async () => ({ success: true, output: '', duration: 1 }) },
      createMockStream(events),
      Date.now(),
      4
    );

    expect(result.content).toContain('没有定位到 00:30-00:40');
    expect(result.content).not.toContain('证据不一致');
  });

  it('detects Chinese summary intent for video tasks and blocks ungrounded final output', async () => {
    const events: any[] = [];
    let callCount = 0;

    const llmClient = {
      async *streamChat() {
        callCount += 1;
        yield {
          type: 'content' as const,
          content:
            'This is a kaleidoscope toy demonstration and optical pattern explanation unrelated to coding model comparisons.',
        };
        yield { type: 'done' as const, finishReason: 'stop' };
      },
    };

    const taskManager = {
      getTaskState: () => ({
        goal: {
          videoUrl: 'https://www.bilibili.com/video/BV1HPFCzzE3y',
          requiresVideoProbe: true,
          requiresVideoDownload: false,
          requiresTranscript: true,
          description: '请分析总结这个视频： https://www.bilibili.com/video/BV1HPFCzzE3y',
        },
      }),
      getToolCallDecision: () => ({ allowed: true }),
      recordToolCall: () => {},
    };

    const result = await processAgentTurn(
      'session-chinese-summary-intent',
      [{ role: 'user', content: '请分析总结这个视频： https://www.bilibili.com/video/BV1HPFCzzE3y' }],
      [],
      { sessionId: 'session-chinese-summary-intent', userId: 'u1', workspaceDir: '/tmp' },
      taskManager,
      { toolCall: { create: async () => ({}) } },
      llmClient,
      { execute: async () => ({ success: true, output: '', duration: 1 }) },
      createMockStream(events),
      Date.now(),
      5
    );

    expect(callCount).toBe(3);
    expect(result.content).toContain('transcript');
    expect(result.content).not.toContain('kaleidoscope');
  });

  it('returns graceful timeout message for video-heavy turns instead of throwing', async () => {
    const events: any[] = [];

    const llmClient = {
      async *streamChat() {
        // Should never be called because timeout is checked before streaming.
        yield { type: 'done' as const, finishReason: 'stop' };
      },
    };

    const taskManager = {
      getTaskState: () => ({
        goal: {
          videoUrl: 'https://www.bilibili.com/video/BV1ZpzhBLE82',
          requiresVideoProbe: true,
          requiresVideoDownload: false,
          requiresTranscript: true,
          description: '请分析总结这个视频： https://www.bilibili.com/video/BV1ZpzhBLE82',
        },
      }),
      getToolCallDecision: () => ({ allowed: true }),
      recordToolCall: () => {},
    };

    const result = await processAgentTurn(
      'session-timeout-video',
      [{ role: 'user', content: '请分析总结这个视频： https://www.bilibili.com/video/BV1ZpzhBLE82' }],
      [],
      { sessionId: 'session-timeout-video', userId: 'u1', workspaceDir: '/tmp' },
      taskManager,
      { toolCall: { create: async () => ({}) } },
      llmClient,
      { execute: async () => ({ success: true, output: '', duration: 1 }) },
      createMockStream(events),
      Date.now() - 13 * 60 * 1000,
      5
    );

    expect(result.finishReason).toBe('timeout');
    expect(result.content).toContain('timed out');
    expect(events.some((event) => event?.type === 'message.delta')).toBe(false);
  });

  it('injects probed video duration into video_transcript params for dynamic timeout tuning', async () => {
    const executedParams: Array<Record<string, any>> = [];
    let llmCall = 0;

    const llmClient = {
      async *streamChat() {
        llmCall += 1;
        if (llmCall === 1) {
          yield {
            type: 'tool_call' as const,
            toolCall: {
              id: 'tc-transcript-duration',
              name: 'video_transcript',
              arguments: JSON.stringify({
                url: 'https://www.bilibili.com/video/BV1ZpzhBLE82',
              }),
            },
          };
          yield { type: 'done' as const, finishReason: 'tool_calls' };
          return;
        }
        yield { type: 'content' as const, content: 'Done.' };
        yield { type: 'done' as const, finishReason: 'stop' };
      },
    };

    const taskManager = {
      getTaskState: () => ({
        goal: {
          videoUrl: 'https://www.bilibili.com/video/BV1ZpzhBLE82',
          requiresVideoProbe: true,
          requiresVideoDownload: false,
          requiresTranscript: true,
          description: '请分析总结这个视频',
        },
      }),
      getToolCallDecision: () => ({ allowed: true }),
      recordToolCall: () => {},
    };

    const probeArtifactContent = JSON.stringify({
      title: 'Long video',
      duration: 5400,
      webpage_url: 'https://www.bilibili.com/video/BV1ZpzhBLE82',
    });

    const result = await processAgentTurn(
      'session-probe-duration-inject',
      [
        { role: 'user', content: '请分析总结这个视频： https://www.bilibili.com/video/BV1ZpzhBLE82' },
        { role: 'tool', content: JSON.stringify({
          success: true,
          output: 'Video probe result',
          artifacts: [{ type: 'data', name: 'video-probe.json', content: probeArtifactContent }],
        }), tool_call_id: 'tc-probe-existing' },
      ],
      [],
      { sessionId: 'session-probe-duration-inject', userId: 'u1', workspaceDir: '/tmp' },
      taskManager,
      { toolCall: { create: async () => ({}) } },
      llmClient,
      {
        execute: async (_tool: string, params: Record<string, any>) => {
          executedParams.push(params);
          return {
            success: true,
            output: 'Transcript extraction completed.\n--- Transcript ---\n[00:00:00.000 --> 00:00:01.000] hello',
            duration: 10,
          };
        },
      },
      createMockStream([]),
      Date.now(),
      5
    );

    expect(result.content.toLowerCase()).toContain('transcript');
    expect(executedParams.length).toBe(1);
    expect(executedParams[0].durationSeconds).toBe(5400);
  });

  it('uses transcript QA for segment follow-up phrasing without explicit video keyword', async () => {
    const transcript = [
      'Transcript extraction completed.',
      '--- Transcript ---',
      '[00:00:00.000 --> 00:00:10.000] 前半段介绍背景',
      '[00:00:10.000 --> 00:00:20.000] 前半段讲核心概念',
      '[00:00:20.000 --> 00:00:30.000] 后半段演示项目实操',
      '[00:00:30.000 --> 00:00:40.000] 后半段讲环境配置与运行',
    ].join('\n');

    const llmClient = {
      async *streamChat() {
        yield {
          type: 'content' as const,
          content:
            'The image shows a fluffy cat with long fur, wide eyes, and a dark background.',
        };
        yield { type: 'done' as const, finishReason: 'stop' };
      },
    };

    const taskManager = {
      getTaskState: () => ({
        goal: {
          requiresVideoProbe: false,
          requiresVideoDownload: false,
          requiresTranscript: false,
          description: '后面1/2讲了啥',
        },
      }),
      getToolCallDecision: () => ({ allowed: true }),
      recordToolCall: () => {},
    };

    const result = await processAgentTurn(
      'session-segment-followup',
      [
        { role: 'user', content: '先总结一下这个视频' },
        {
          role: 'tool',
          content: JSON.stringify({ success: true, output: transcript }),
          tool_call_id: 'historical-video-transcript-1',
        },
        { role: 'user', content: '后面1/2讲了啥' },
      ],
      [],
      { sessionId: 'session-segment-followup', userId: 'u1', workspaceDir: '/tmp' },
      taskManager,
      { toolCall: { create: async () => ({}) } },
      llmClient,
      { execute: async () => ({ success: true, output: '' }) },
      createMockStream([]),
      Date.now(),
      4
    );

    expect(result.content).toContain('00:20-00:40');
    expect(result.content).toContain('后半段演示项目实操');
    expect(result.content).toContain('后半段讲环境配置与运行');
    expect(result.content).not.toContain('fluffy cat');
  });

  it('uses llm follow-up intent inference for multilingual segment questions', async () => {
    const transcript = [
      'Transcript extraction completed.',
      '--- Transcript ---',
      '[00:00:00.000 --> 00:00:10.000] intro and context',
      '[00:00:10.000 --> 00:00:20.000] architecture basics',
      '[00:00:20.000 --> 00:00:30.000] implementation walkthrough',
      '[00:00:30.000 --> 00:00:40.000] deployment and debugging',
    ].join('\n');

    const llmClient = {
      async *streamChat(messages: ExtendedLLMMessage[]) {
        const system = String(messages?.[0]?.content || '');
        if (system.includes('follow-up should be answered from existing video transcript context')) {
          yield { type: 'content' as const, content: '{"useTranscriptContext":true}' };
          yield { type: 'done' as const, finishReason: 'stop' };
          return;
        }
        if (system.includes('You classify user intent for transcript QA')) {
          yield {
            type: 'content' as const,
            content:
              '{"intent":"time_range","range":{"type":"relative","anchor":"tail","numerator":1,"denominator":2},"language":"auto"}',
          };
          yield { type: 'done' as const, finishReason: 'stop' };
          return;
        }
        yield { type: 'content' as const, content: 'The image shows a fluffy cat with long fur.' };
        yield { type: 'done' as const, finishReason: 'stop' };
      },
    };

    const taskManager = {
      getTaskState: () => ({
        goal: {
          requiresVideoProbe: false,
          requiresVideoDownload: false,
          requiresTranscript: false,
          description: '¿Qué explica la última mitad?',
        },
      }),
      getToolCallDecision: () => ({ allowed: true }),
      recordToolCall: () => {},
    };

    const result = await processAgentTurn(
      'session-segment-followup-es',
      [
        { role: 'user', content: 'Summarize this video first.' },
        {
          role: 'tool',
          content: JSON.stringify({ success: true, output: transcript }),
          tool_call_id: 'historical-video-transcript-es',
        },
        { role: 'user', content: '¿Qué explica la última mitad?' },
      ],
      [],
      { sessionId: 'session-segment-followup-es', userId: 'u1', workspaceDir: '/tmp' },
      taskManager,
      { toolCall: { create: async () => ({}) } },
      llmClient,
      { execute: async () => ({ success: true, output: '' }) },
      createMockStream([]),
      Date.now(),
      4
    );

    expect(result.content).toContain('00:20-00:40');
    expect(result.content).toContain('implementation walkthrough');
    expect(result.content).toContain('deployment and debugging');
    expect(result.content).not.toContain('fluffy cat');
  });

  it('skips duplicate video_transcript calls after one transcript already succeeded', async () => {
    let llmCall = 0;
    const events: any[] = [];
    const executeCalls: string[] = [];

    const llmClient = {
      async *streamChat() {
        llmCall += 1;
        if (llmCall === 1) {
          yield {
            type: 'tool_call' as const,
            toolCall: {
              id: 'probe-1',
              name: 'video_probe',
              arguments: JSON.stringify({ url: 'https://www.bilibili.com/video/BV1GqcWzuELB' }),
            },
          };
          yield {
            type: 'tool_call' as const,
            toolCall: {
              id: 'transcript-1',
              name: 'video_transcript',
              arguments: JSON.stringify({ url: 'https://www.bilibili.com/video/BV1GqcWzuELB' }),
            },
          };
          yield {
            type: 'tool_call' as const,
            toolCall: {
              id: 'transcript-2',
              name: 'video_transcript',
              arguments: JSON.stringify({ url: 'https://www.bilibili.com/video/BV1GqcWzuELB' }),
            },
          };
          yield { type: 'done' as const, finishReason: 'tool_calls' };
          return;
        }
        yield { type: 'content' as const, content: 'Done.' };
        yield { type: 'done' as const, finishReason: 'stop' };
      },
    };

    const taskManager = {
      getTaskState: () => ({
        goal: {
          description: 'summarize this video',
          videoUrl: 'https://www.bilibili.com/video/BV1GqcWzuELB',
          requiresVideoProbe: true,
          requiresVideoDownload: false,
          requiresTranscript: true,
        },
      }),
      getToolCallDecision: () => ({ allowed: true }),
      recordToolCall: () => {},
    };

    const result = await processAgentTurn(
      'session-video-dedupe',
      [{ role: 'user', content: 'summarize this video' }],
      [],
      { sessionId: 'session-video-dedupe', userId: 'u1', workspaceDir: '/tmp' },
      taskManager,
      { toolCall: { create: async () => ({}) } },
      llmClient,
      {
        execute: async (toolName: string) => {
          executeCalls.push(toolName);
          if (toolName === 'video_probe') {
            return {
              success: true,
              output: 'probe ok',
              artifacts: [{ name: 'video-probe.json', content: '{"duration":123}' }],
            };
          }
          return {
            success: true,
            output: 'Transcript extraction completed.\n--- Transcript ---\nline 1\nline 2',
            artifacts: [{ type: 'file', name: 'transcript.txt', fileId: 'f1' }],
          };
        },
      },
      createMockStream(events),
      Date.now(),
      5
    );

    expect(result.content.length).toBeGreaterThan(0);
    expect(executeCalls.filter((name) => name === 'video_transcript').length).toBe(1);
  });

  it('does not execute video_download unless user explicitly requested download', async () => {
    let llmCall = 0;
    const executeCalls: string[] = [];

    const llmClient = {
      async *streamChat() {
        llmCall += 1;
        if (llmCall === 1) {
          yield {
            type: 'tool_call' as const,
            toolCall: {
              id: 'download-1',
              name: 'video_download',
              arguments: JSON.stringify({ url: 'https://www.bilibili.com/video/BV1GqcWzuELB' }),
            },
          };
          yield { type: 'done' as const, finishReason: 'tool_calls' };
          return;
        }
        yield { type: 'content' as const, content: 'Skipped download and continued.' };
        yield { type: 'done' as const, finishReason: 'stop' };
      },
    };

    const taskManager = {
      getTaskState: () => ({
        goal: {
          description: 'summarize this video',
          videoUrl: 'https://www.bilibili.com/video/BV1GqcWzuELB',
          requiresVideoProbe: true,
          requiresVideoDownload: false,
          requiresTranscript: false,
        },
      }),
      getToolCallDecision: () => ({ allowed: true }),
      recordToolCall: () => {},
    };

    const result = await processAgentTurn(
      'session-video-no-download',
      [{ role: 'user', content: 'summarize this video' }],
      [],
      { sessionId: 'session-video-no-download', userId: 'u1', workspaceDir: '/tmp' },
      taskManager,
      { toolCall: { create: async () => ({}) } },
      llmClient,
      {
        execute: async (toolName: string) => {
          executeCalls.push(toolName);
          return { success: true, output: 'ok' };
        },
      },
      createMockStream([]),
      Date.now(),
      4
    );

    expect(result.content).toContain('Skipped download');
    expect(executeCalls.includes('video_download')).toBe(false);
  });

  it('returns transcript-extraction failure message instead of claiming tools were not executed', async () => {
    let llmCall = 0;

    const llmClient = {
      async *streamChat() {
        llmCall += 1;
        if (llmCall === 1) {
          yield {
            type: 'tool_call' as const,
            toolCall: {
              id: 'transcript-fail-1',
              name: 'video_transcript',
              arguments: JSON.stringify({ url: 'https://www.bilibili.com/video/BV1GqcWzuELB' }),
            },
          };
          yield { type: 'done' as const, finishReason: 'tool_calls' };
          return;
        }
        yield { type: 'content' as const, content: 'I can summarize now.' };
        yield { type: 'done' as const, finishReason: 'stop' };
      },
    };

    const taskManager = {
      getTaskState: () => ({
        goal: {
          description: 'summarize this video',
          videoUrl: 'https://www.bilibili.com/video/BV1GqcWzuELB',
          requiresVideoProbe: true,
          requiresVideoDownload: false,
          requiresTranscript: true,
        },
      }),
      getToolCallDecision: () => ({ allowed: true }),
      recordToolCall: () => {},
    };

    const result = await processAgentTurn(
      'session-video-transcript-failed',
      [{ role: 'user', content: 'summarize this video' }],
      [],
      { sessionId: 'session-video-transcript-failed', userId: 'u1', workspaceDir: '/tmp' },
      taskManager,
      { toolCall: { create: async () => ({}) } },
      llmClient,
      {
        execute: async () => ({ success: false, output: '', error: 'transcript extraction failed' }),
      },
      createMockStream([]),
      Date.now(),
      4
    );

    expect(result.content).toContain('did not return usable transcript content');
    expect(result.content).not.toContain('required video tools were not executed');
  });
});
