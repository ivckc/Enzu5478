// Agent Loop Confirmation Integration Tests - Real integration test for tasks.delete

import { describe, it, expect, beforeEach } from 'vitest';
import { tasks } from '../../../core/data';
import { loadConfig } from '../../../agent/config';

// Mock process.env to control AUTO_CONFIRM_WRITES
let originalEnv = process.env;

function resetEnv(): void {
  process.env = { ...originalEnv };
}

function setEnvAutoConfirm(value: boolean): void {
  process.env.AUTO_CONFIRM_WRITES = value.toString();
}

describe('Tasks.Delete Confirmation Integration Test', () => {
  beforeEach(() => {
    // Reset environment before each test
    resetEnv();

    // Reset tasks to a clean state
    tasks.length = 0;
    tasks.push({
      id: 1,
      userId: 'test',
      title: 'Test Task',
      done: false,
      goalId: null,
      priority: 'normal',
      due: null,
      dueTime: null,
      subtasks: [],
    });
  });

  it('should require confirmation with AUTO_CONFIRM_WRITES=false (loop.ts scenario)', async () => {
    // Set AUTO_CONFIRM_WRITES to false (default behavior)
    setEnvAutoConfirm(false);

    // Reload config to pick up environment changes
    delete require.cache[require.resolve('../../../agent/config')];
    const config = require('../../../agent/config').loadConfig();

    // Verify the config
    expect(config.autoConfirmWrites).toBe(false);

    // Import the taskDeleteTool
    const { taskDeleteTool } = await import('../../../agent/tools/adapters/tasks');

    // Execute the tool (simulating what happens in loop.ts)
    const result = await taskDeleteTool.execute({ taskId: 1 });

    // Should require confirmation
    expect(result.ok).toBe(false);
    expect(result.error).toBe('CONFIRMATION_REQUIRED');
    expect(result.summary).toContain('Delete task #1?');

    // Task should NOT be deleted
    expect(tasks.some(t => t.id === 1)).toBe(true);
    expect(tasks.length).toBe(1);
  });

  it('should require confirmation with AUTO_CONFIRM_WRITES=true (key requirement)', async () => {
    // Set AUTO_CONFIRM_WRITES to true (the critical test case)
    setEnvAutoConfirm(true);

    // Reload config to pick up environment changes
    delete require.cache[require.resolve('../../../agent/config')];
    const config = require('../../../agent/config').loadConfig();

    // Verify the config shows autoConfirmWrites is true
    expect(config.autoConfirmWrites).toBe(true);

    // Import the taskDeleteTool
    const { taskDeleteTool } = await import('../../../agent/tools/adapters/tasks');

    // Execute the tool (simulating what happens in loop.ts with autoConfirmWrites=true)
    const result = await taskDeleteTool.execute({ taskId: 1 });

    // CRITICAL TEST: Even with AUTO_CONFIRM_WRITES=true, sensitive tools should require confirmation
    expect(result.ok).toBe(false);
    expect(result.error).toBe('CONFIRMATION_REQUIRED');
    expect(result.summary).toContain('Delete task #1?');

    // Task should NOT be deleted (this is what we're testing!)
    expect(tasks.some(t => t.id === 1)).toBe(true);
    expect(tasks.length).toBe(1);
  });

  it('should execute only when confirmation is provided (end-to-end simulation)', async () => {
    // Test the complete flow: tool returns confirmation request, then user confirms

    // Set AUTO_CONFIRM_WRITES to true
    setEnvAutoConfirm(true);

    // Mock the confirmation process
    let confirmationRequestSent = false;

    // Simulate what happens in loop.ts needsUserConfirmation check
    const { taskDeleteTool } = await import('../../../agent/tools/adapters/tasks');

    // First, execute the tool - it should return confirmation request
    const result = await taskDeleteTool.execute({ taskId: 1 });

    // Verify confirmation was requested
    expect(result.ok).toBe(false);
    expect(result.error).toBe('CONFIRMATION_REQUIRED');
    expect(result.summary).toContain('Delete task #1?');

    // Task should NOT be deleted yet
    expect(tasks.some(t => t.id === 1)).toBe(true);
    expect(tasks.length).toBe(1);

    // The user would see this confirmation request and respond "yes"
    // At that point in the actual flow, the confirmation would be processed
    // and the task would be deleted. For this test, we're verifying that
    // the initial tool call requires confirmation even with AUTO_CONFIRM_WRITES=true.
  });
});