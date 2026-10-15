// Task Tools Tests - Test tasks.delete confirmation requirement with AUTO_CONFIRM_WRITES

import { describe, it, expect } from 'vitest';
import { tasks } from '../../../core/data';
import { loadConfig } from '../../../agent/config';

// Mock the environment for testing
let originalEnv = process.env;

// Mock saveTasks function to avoid actual file writes
let mockSaveTasks: jest.Func<[], boolean>;

function resetEnv(): void {
  process.env = { ...originalEnv };
}

function setEnvAutoConfirm(value: boolean): void {
  process.env.AUTO_CONFIRM_WRITES = value.toString();
}

// Helper to reload config to pick up environment changes
function reloadConfig() {
  // Clear the module cache to force re-import
  delete require.cache[require.resolve('../../../agent/config')];
  return require('../../../agent/config').loadConfig();
}

describe('Task Delete Confirmation', () => {
  beforeEach(() => {
    // Reset environment before each test
    resetEnv();

    // Add a test task for each test case
    const testTask = {
      id: 1,
      userId: 'test',
      title: 'Test Task for Delete',
      done: false,
      goalId: null,
      priority: 'normal',
      due: null,
      dueTime: null,
      subtasks: [],
    };

    // Save original tasks state and reset to include test task
    const originalTasks = tasks.slice();
    tasks.length = 0;
    tasks.push(testTask);
  });

  it('should require confirmation even with AUTO_CONFIRM_WRITES=true', async () => {
    // Set environment to auto-confirm writes
    setEnvAutoConfirm(true);

    // Reload config to ensure AUTO_CONFIRM_WRITES=true is applied
    const config = reloadConfig();

    // Verify config shows autoConfirmWrites is true
    expect(config.autoConfirmWrites).toBe(true);

    // Import taskDeleteTool after setting env to ensure it uses current config
    const { taskDeleteTool } = await import('../../../agent/tools/adapters/tasks');

    // Execute delete operation
    const result = await taskDeleteTool.execute({ taskId: 1 });

    // Even with autoConfirmWrites=true, sensitive operations like delete should require confirmation
    expect(result.ok).toBe(false);
    expect(result.error).toBe('CONFIRMATION_REQUIRED');
    expect(result.summary).toContain('Delete task #1?');

    // Verify the task still exists (not deleted)
    expect(tasks.some(t => t.id === 1)).toBe(true);
    expect(tasks[0].title).toBe('Test Task for Delete');
  });

  it('should require confirmation even with AUTO_CONFIRM_WRITES=false', async () => {
    // Ensure environment does NOT auto-confirm writes
    setEnvAutoConfirm(false);

    const config = reloadConfig();
    expect(config.autoConfirmWrites).toBe(false);

    const { taskDeleteTool } = await import('../../../agent/tools/adapters/tasks');
    const result = await taskDeleteTool.execute({ taskId: 1 });

    // Should still require confirmation for sensitive operations
    expect(result.ok).toBe(false);
    expect(result.error).toBe('CONFIRMATION_REQUIRED');
    expect(result.summary).toContain('Delete task #1?');

    // Verify the task still exists
    expect(tasks.some(t => t.id === 1)).toBe(true);
  });

  it('should not delete task when confirmation required', async () => {
    // Test with autoConfirmWrites=true to confirm the requirement persists
    setEnvAutoConfirm(true);
    const config = reloadConfig();
    expect(config.autoConfirmWrites).toBe(true);

    const { taskDeleteTool } = await import('../../../agent/tools/adapters/tasks');

    // Try to delete
    const result = await taskDeleteTool.execute({ taskId: 1 });

    // Should return confirmation request, not execute deletion
    expect(result.ok).toBe(false);
    expect(result.error).toBe('CONFIRMATION_REQUIRED');

    // Task count should remain the same (task not deleted)
    expect(tasks.length).toBe(1);
    expect(tasks[0].id).toBe(1);
    expect(tasks[0].title).toBe('Test Task for Delete');
  });
});