import { describe, expect, it, vi, beforeEach } from 'vitest';
import { WebUntisClient } from './client.js';
import { queueWebUntisClassregEvent } from './sync.js';

describe('WebUntis integration', () => {
  it('initializes with default production environment and switches to playground', () => {
    const client = new WebUntisClient();
    expect(client.getEnvironment()).toBe('production');
    expect(client.getConfig().server).toBe('ms-telfs.webuntis.com');
    expect(client.getConfig().school).toBe('ms-telfs');

    client.setEnvironment('playground');
    expect(client.getEnvironment()).toBe('playground');
    expect(client.getConfig().server).toBe('playground.webuntis.com');
    expect(client.getConfig().school).toBe('PG6ef0f7d3-abdf-49b5-ab74-044ef932d877');

    client.setEnvironment('production');
    expect(client.getEnvironment()).toBe('production');
  });

  it('dispatches auto-sync disciplinary events without throwing', async () => {
    // Should run asynchronously without error
    expect(() => {
      queueWebUntisClassregEvent({
        pupilId: 101,
        classId: 430,
        type: 'yellow',
        note: 'Störung des Unterrichts',
      });
      queueWebUntisClassregEvent({
        pupilId: 102,
        classId: 430,
        type: 'red',
        note: 'Tätlicher Übergriff',
      });
      queueWebUntisClassregEvent({
        pupilId: 103,
        classId: 430,
        type: 'timeout',
        note: 'Arbeitsblatt Mathe',
      });
    }).not.toThrow();
  });
});
