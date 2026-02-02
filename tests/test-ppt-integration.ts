#!/usr/bin/env bun

/**
 * Test Script: PPT Generator Integration Test
 * Tests ppt_generator tool end-to-end without requiring sandbox
 *
 * Usage: bun tests/test-ppt-integration.ts
 */

import path from 'path';
import { promises as fs } from 'fs';
// We'll import the tool dynamically at runtime

/**
 * Test presentations
 */
const TEST_CASES = [
  {
    name: 'Simple 2-slide presentation',
    input: {
      presentation: {
        title: 'AI for Everyone',
        subtitle: 'Understanding Artificial Intelligence',
        author: 'Mark Agent',
        slides: [
          {
            title: 'What is AI?',
            content: [
              'Artificial Intelligence is a simulation of human intelligence by machines',
              'AI can learn, reason, and solve problems',
            ],
            bullets: ['Machine Learning', 'Natural Language Processing', 'Computer Vision'],
          },
          {
            title: 'Why AI Matters',
            content: ['AI is transforming every industry'],
            bullets: ['Healthcare diagnosis', 'Financial fraud detection', 'Autonomous vehicles'],
          },
        ],
      },
      filename: 'ai-intro.pptx',
    },
    expectedSuccess: true,
  },
  {
    name: 'Complex presentation with notes',
    input: {
      presentation: {
        title: 'Product Roadmap 2024',
        slides: [
          {
            title: 'Q1 Objectives',
            content: ['Complete MVP', 'Onboard first 100 users'],
            bullets: ['Task A', 'Task B', 'Task C'],
            notes: 'Discuss timeline with stakeholders',
          },
          {
            title: 'Q2 Goals',
            content: ['User acquisition campaign', 'Performance optimization'],
          },
          {
            title: 'Q3 Expansion',
            content: ['New features', 'International markets'],
            notes: 'Prepare budget proposal',
          },
          {
            title: 'Q4 Year-end',
            content: ['Annual review', 'Planning for 2025'],
          },
        ],
      },
      filename: 'roadmap-2024.pptx',
    },
    expectedSuccess: true,
  },
  {
    name: 'Edge case - Minimal presentation',
    input: {
      presentation: {
        title: 'Status Update',
        slides: [
          {
            title: 'Current Status',
            content: ['All systems operational'],
          },
        ],
      },
      filename: 'status.pptx',
    },
    expectedSuccess: true,
  },
  {
    name: 'Edge case - Missing title',
    input: {
      presentation: {
        title: '',
        slides: [{ title: 'Test', content: ['Test'] }],
      },
      filename: 'invalid-title.pptx',
    },
    expectedSuccess: false,
    expectedError: 'title',
  },
  {
    name: 'Edge case - No slides',
    input: {
      presentation: {
        title: 'Test',
        slides: [],
      },
      filename: 'no-slides.pptx',
    },
    expectedSuccess: false,
    expectedError: 'at least one slide',
  },
  {
    name: 'Edge case - Empty presentation',
    input: {
      presentation: null,
    },
    filename: 'empty.pptx',
    expectedSuccess: false,
    expectedError: 'required',
  },
];

/**
 * Colors
 */
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const NC = '\x1b[0m';

/**
 * Run a single test
 */
async function runTest(testCase: any, PptGeneratorTool: any): Promise<{ pass: boolean; error?: string }> {
  // Tool saves to outputs/ppt/ directory
  const outputDir = path.join(process.cwd(), 'outputs', 'ppt-test-integration');

  const context = {
    sessionId: 'test-session',
    userId: 'test-user',
    workspaceDir: '/tmp/test-ppt-workspace', // Workspace (not used for file output)
  };

  const tool = new PptGeneratorTool(context);

  try {
    const result = await tool.execute(testCase.input);

    if (testCase.expectedSuccess) {
      if (result.success) {
        console.log(`  ${GREEN}✅ PASS${NC} - ${testCase.name}`);
        console.log(`      ${result.output.split('\n')[0]}`);
        console.log(`      📄 ${testCase.input.filename || 'presentation.pptx'}`);
        console.log(`      📊 ${testCase.input.presentation?.slides?.length || 0 + 1} slides`);

        const filename = testCase.input.filename || 'presentation.pptx';
        // Tool saves to outputs/ppt/ directory
        const filePath = path.join(process.cwd(), 'outputs', 'ppt', filename);
        const exists = await fs.access(filePath).then(() => true).catch(() => false);

        if (!exists) {
          return { pass: false, error: 'File not created' };
        }

        const stats = await fs.stat(filePath);
        const sizeKB = (stats.size / 1024).toFixed(2);
        console.log(`      📦 ${sizeKB} KB`);

        return { pass: true };
      } else {
        console.log(`  ${RED}❌ FAIL${NC} - ${testCase.name}`);
        console.log(`      Expected success but got: ${result.error || 'Unknown error'}`);
        return { pass: false, error: result.error };
      }
    } else {
      if (!result.success) {
        const errorMsg = result.error || '';

        if (testCase.expectedError && errorMsg.toLowerCase().includes(testCase.expectedError.toLowerCase())) {
          console.log(`  ${GREEN}✅ PASS${NC} - ${testCase.name}`);
          console.log(`      Correctly rejected: ${errorMsg}`);
          return { pass: true };
        } else {
          console.log(`  ${RED}❌ FAIL${NC} - ${testCase.name}`);
          console.log(`      Expected error containing "${testCase.expectedError}" but got: ${errorMsg}`);
          return { pass: false, error: errorMsg };
        }
      } else {
        console.log(`  ${RED}❌ FAIL${NC} - ${testCase.name}`);
        console.log(`      Should have failed but succeeded`);
        return { pass: false };
      }
    }
  } catch (error: any) {
    console.log(`  ${RED}❌ ERROR${NC} - ${testCase.name}`);
    console.log(`      Unexpected error: ${error.message}`);
    return { pass: false, error: error.message };
  }
}

/**
 * Clean up output directory
 */
async function cleanup(outputDir: string) {
  try {
    await fs.rm(outputDir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
}

/**
 * Main test runner
 */
async function main() {
  console.log('\n' + '='.repeat(60));
  console.log('🎯 PPT GENERATOR INTEGRATION TEST SUITE');
  console.log('='.repeat(60) + '\n');

  // Dynamically import the tool
  const pptModule = await import('../apps/api/src/services/tools/ppt_generator');
  const PptGeneratorTool = pptModule.PptGeneratorTool;

  const results: { pass: boolean; error?: string }[] = [];

  for (const testCase of TEST_CASES) {
    const result = await runTest(testCase, PptGeneratorTool);
    results.push(result);
    console.log('');
  }

  const passed = results.filter(r => r.pass).length;
  const failed = results.filter(r => !r.pass).length;

  console.log('='.repeat(60));
  console.log('📊 TEST SUMMARY');
  console.log('='.repeat(60));
  console.log(`  ${GREEN}✅ Passed:${NC} ${passed}/${results.length}`);
  console.log(`  ${RED}❌ Failed:${NC} ${failed}/${results.length}`);
  console.log(`  ${YELLOW}📈 Success Rate:${NC} ${((passed / results.length) * 100).toFixed(1)}%`);
  console.log('='.repeat(60) + '\n');

  if (failed === 0) {
    console.log(`${GREEN}🎉 ALL TESTS PASSED!${NC}\n`);
    console.log('The ppt_generator tool is working correctly.\n');
    console.log('Generated files are saved in: outputs/ppt/\n');
  } else {
    console.log(`${YELLOW}⚠️  ${failed} test(s) failed.${NC}\n`);
    results.filter(r => !r.pass).forEach(r => {
      console.log(`  - ${RED}${r.error || 'Unknown error'}${NC}`);
    });
  }

  // Clean up output directory
  const outputDir = path.join(process.cwd(), 'outputs', 'ppt-test-integration');
  await cleanup(outputDir);

  process.exit(failed === 0 ? 0 : 1);
}

main();
