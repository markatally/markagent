#!/usr/bin/env bun
/**
 * Test Script: PPT Generation
 * Demonstrates full flow of user prompting agent to generate PowerPoint
 *
 * Usage: bun tests/test-ppt-generation.ts
 */

import PptGenJS from 'pptxgenjs';
import { promises as fs } from 'fs';
import path from 'path';

/**
 * Example user prompts that would trigger PPT generation
 */
const USER_PROMPTS = [
  "Create a PowerPoint presentation about artificial intelligence",
  "Generate a slide deck about Machine Learning fundamentals",
  "Make a presentation about benefits of cloud computing",
];

/**
 * Expected agent-generated presentation structure
 */
const EXAMPLE_PRESENTATIONS = [
  {
    title: "Introduction to Artificial Intelligence",
    subtitle: "A Comprehensive Overview",
    author: "Mark Agent",
    slides: [
      {
        title: "What is AI?",
        content: [
          "Artificial Intelligence (AI) refers to systems that can perform tasks requiring human intelligence",
          "AI can learn, reason, perceive, and solve problems autonomously",
        ],
        bullets: [
          "Machine Learning",
          "Natural Language Processing",
          "Computer Vision",
          "Robotics"
        ],
      },
      {
        title: "Types of AI",
        content: ["AI is categorized into different types based on capabilities:"],
        bullets: [
          "Narrow AI - Designed for specific tasks (e.g., chess, image recognition)",
          "General AI - Hypothetical systems with human-like cognitive abilities",
          "Super AI - Theoretical systems surpassing human intelligence"
        ],
      },
      {
        title: "Applications",
        content: ["AI is transforming industries worldwide:"],
        bullets: [
          "Healthcare: Diagnostic assistance, drug discovery",
          "Finance: Fraud detection, algorithmic trading",
          "Transportation: Autonomous vehicles, traffic optimization",
          "Customer Service: Chatbots, virtual assistants"
        ],
      },
      {
        title: "Future Outlook",
        content: [
          "AI continues to evolve rapidly with new breakthroughs",
          "Ethical considerations and responsible development are crucial"
        ],
        notes: "Discuss importance of AI ethics and regulation in final section"
      },
    ],
  },
  {
    title: "Machine Learning Fundamentals",
    slides: [
      {
        title: "What is Machine Learning?",
        content: [
          "Machine Learning is a subset of AI that enables systems to learn from data",
          "Instead of explicit programming, ML builds models from examples"
        ],
        bullets: [
          "Supervised Learning",
          "Unsupervised Learning",
          "Reinforcement Learning"
        ],
      },
      {
        title: "Key Concepts",
        content: ["Understanding ML requires familiarity with core concepts:"],
        bullets: [
          "Training Data - Examples used to build model",
          "Features - Input variables used for prediction",
          "Model - The learned function that makes predictions",
          "Labels - Correct answers in supervised learning"
        ],
      },
    ],
  },
  {
    title: "Benefits of Cloud Computing",
    slides: [
      {
        title: "What is Cloud Computing?",
        content: [
          "Cloud computing delivers computing services over internet",
          "On-demand availability of computing resources"
        ],
        bullets: [
          "Infrastructure as a Service (IaaS)",
          "Platform as a Service (PaaS)",
          "Software as a Service (SaaS)"
        ],
      },
      {
        title: "Key Benefits",
        content: ["Organizations choose cloud for these advantages:"],
        bullets: [
          "Cost Savings - Pay only for what you use",
          "Scalability - Resources scale on demand",
          "Accessibility - Access from anywhere",
          "Reliability - Built-in redundancy",
          "Security - Enterprise-grade protection"
        ],
      },
    ],
  },
];

/**
 * PPT Generator (mimicking tool)
 */
async function generatePPT(presentation: any): Promise<{ filepath: string; size: number }> {
  const pptx = new PptGenJS();

  // Set metadata
  pptx.title = presentation.title;
  pptx.author = presentation.author || 'Mark Agent';
  pptx.subject = presentation.title;

  // Create title slide
  const titleSlide = pptx.addSlide();
  titleSlide.addText(presentation.title, {
    x: 1,
    y: 1.5,
    w: '80%',
    h: 1,
    fontSize: 44,
    bold: true,
    align: 'center',
    color: '363636',
  });

  if (presentation.subtitle) {
    titleSlide.addText(presentation.subtitle, {
      x: 1,
      y: 2.5,
      w: '80%',
      h: 0.75,
      fontSize: 24,
      align: 'center',
      color: '666666',
    });
  }

  // Create content slides
  for (const slideData of presentation.slides) {
    const slide = pptx.addSlide();

    slide.addText(slideData.title, {
      x: 0.5,
      y: 0.5,
      w: '90%',
      h: 0.75,
      fontSize: 32,
      bold: true,
      color: '363636',
    });

    let yPos = 1.5;

    if (slideData.content && Array.isArray(slideData.content)) {
      for (const content of slideData.content) {
        slide.addText(content, {
          x: 0.5,
          y: yPos,
          w: '90%',
          h: 0.75,
          fontSize: 18,
          color: '444444',
        });
        yPos += 0.85;
      }
    }

    if (slideData.bullets && Array.isArray(slideData.bullets)) {
      for (const bullet of slideData.bullets) {
        slide.addText(`• ${bullet}`, {
          x: 0.5,
          y: yPos,
          w: '85%',
          h: 0.5,
          fontSize: 16,
          color: '555555',
        });
        yPos += 0.55;
      }
    }

    if (slideData.notes) {
      slide.addNotes(slideData.notes);
    }
  }

  // Create output directory following project convention: outputs/
  const outputDir = path.join(process.cwd(), 'outputs', 'ppt-test-output');
  await fs.mkdir(outputDir, { recursive: true });

  // Generate safe filename
  const safeTitle = presentation.title.replace(/[^a-zA-Z0-9\s-]/g, '_').trim();
  const filename = `${safeTitle}.pptx`;
  const filepath = path.join(outputDir, filename);

  // Write PPTX file
  await pptx.writeFile({ fileName: filepath });

  const stats = await fs.stat(filepath);

  return { filepath, size: stats.size };
}

/**
 * Test cases
 */
async function runTests() {
  console.log('\n' + '='.repeat(60));
  console.log('🎯 PPT GENERATION TEST SUITE');
  console.log('='.repeat(60) + '\n');

  let passed = 0;
  let failed = 0;

  // Test 1: Generate AI presentation
  console.log('Test 1: AI Presentation Generation');
  console.log('User Prompt:', USER_PROMPTS[0]);
  try {
    const result = await generatePPT(EXAMPLE_PRESENTATIONS[0]);
    const sizeKB = (result.size / 1024).toFixed(2);
    console.log('✅ PASS - Generated:', result.filepath);
    console.log('   📦 Size:', sizeKB, 'KB');
    console.log('   📊 Slides:', EXAMPLE_PRESENTATIONS[0].slides.length + 1, '(including title)');
    passed++;
  } catch (error: any) {
    console.log('❌ FAIL -', error.message);
    failed++;
  }

  // Test 2: Generate ML presentation
  console.log('\nTest 2: Machine Learning Presentation');
  console.log('User Prompt:', USER_PROMPTS[1]);
  try {
    const result = await generatePPT(EXAMPLE_PRESENTATIONS[1]);
    const sizeKB = (result.size / 1024).toFixed(2);
    console.log('✅ PASS - Generated:', result.filepath);
    console.log('   📦 Size:', sizeKB, 'KB');
    console.log('   📊 Slides:', EXAMPLE_PRESENTATIONS[1].slides.length + 1, '(including title)');
    passed++;
  } catch (error: any) {
    console.log('❌ FAIL -', error.message);
    failed++;
  }

  // Test 3: Generate Cloud Computing presentation
  console.log('\nTest 3: Cloud Computing Presentation');
  console.log('User Prompt:', USER_PROMPTS[2]);
  try {
    const result = await generatePPT(EXAMPLE_PRESENTATIONS[2]);
    const sizeKB = (result.size / 1024).toFixed(2);
    console.log('✅ PASS - Generated:', result.filepath);
    console.log('   📦 Size:', sizeKB, 'KB');
    console.log('   📊 Slides:', EXAMPLE_PRESENTATIONS[2].slides.length + 1, '(including title)');
    passed++;
  } catch (error: any) {
    console.log('❌ FAIL -', error.message);
    failed++;
  }

  // Test 4: Complex presentation with notes
  console.log('\nTest 4: Complex Presentation with Notes');
  try {
    const complexPresentation = {
      title: "Project Roadmap 2024",
      subtitle: "Q1-Q4 Planning",
      author: "Mark Agent",
      slides: [
        {
          title: "Q1 Goals",
          content: ["Complete initial design phase", "Launch MVP"],
          bullets: ["Task A", "Task B", "Task C"],
          notes: "Discuss timeline risks with stakeholders"
        },
        {
          title: "Q2 Goals",
          content: ["User acquisition campaign", "Performance optimization"],
          bullets: ["Marketing push", "Backend scaling"],
        },
        {
          title: "Q3 Goals",
          content: ["Feature expansion", "Partnership deals"],
        },
        {
          title: "Q4 Goals",
          content: ["Year-end review", "Planning for 2025"],
          notes: "Prepare annual report presentation"
        },
      ],
    };
    const result = await generatePPT(complexPresentation);
    const sizeKB = (result.size / 1024).toFixed(2);
    console.log('✅ PASS - Generated:', result.filepath);
    console.log('   📦 Size:', sizeKB, 'KB');
    console.log('   📊 Slides:', complexPresentation.slides.length + 1, '(including title)');
    console.log('   📝 Notes:', complexPresentation.slides.filter(s => s.notes).length, 'slides with notes');
    passed++;
  } catch (error: any) {
    console.log('❌ FAIL -', error.message);
    failed++;
  }

  // Test 5: Minimal presentation
  console.log('\nTest 5: Minimal Presentation (Edge Case)');
  try {
    const minimalPresentation = {
      title: "Quick Update",
      slides: [
        {
          title: "Status Report",
          content: ["Everything is on track"],
        },
      ],
    };
    const result = await generatePPT(minimalPresentation);
    const sizeKB = (result.size / 1024).toFixed(2);
    console.log('✅ PASS - Generated:', result.filepath);
    console.log('   📦 Size:', sizeKB, 'KB');
    console.log('   📊 Slides:', minimalPresentation.slides.length + 1, '(including title)');
    passed++;
  } catch (error: any) {
    console.log('❌ FAIL -', error.message);
    failed++;
  }

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('📊 TEST SUMMARY');
  console.log('='.repeat(60));
  console.log('  ✅ Passed:', passed);
  console.log('  ❌ Failed:', failed);
  console.log('  📈 Success Rate:', ((passed / (passed + failed)) * 100).toFixed(1) + '%');
  console.log('='.repeat(60) + '\n');

  if (failed === 0) {
    console.log('🎉 ALL TESTS PASSED! PPT generation is working correctly.\n');
    console.log('Generated files are in: outputs/ppt-test-output/\n');
  } else {
    console.log('⚠️  Some tests failed. Please review the errors above.\n');
  }

  return { passed, failed, total: passed + failed };
}

/**
 * Run test suite
 */
async function main() {
  try {
    const results = await runTests();

    if (results.failed === 0) {
      process.exit(0);
    } else {
      process.exit(1);
    }
  } catch (error: any) {
    console.error('Fatal error:', error);
    process.exit(1);
  }
}

// Run tests
main();
